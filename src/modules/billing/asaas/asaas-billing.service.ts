import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Organization, Prisma } from '@prisma/client'
import { PrismaService } from '../../../prisma/prisma.service'
import { CancelSubscriptionDto, ChangeSubscriptionDto, SubscribeDto } from '../dto/subscription.dto'
import { assertPlanSeats, findPlan, planName, priceFor } from '../plans.config'
import { SubscriptionCache } from '../subscription-cache'
import { AsaasClient } from './asaas.client'
import { asaasDay, isPaidStatus, laterDate, periodEndForPayment, upsertPayment } from './asaas-payments'
import type { AsaasBillingType, AsaasCustomerInput, AsaasPayment } from './asaas.types'

type Actor = { organizationId: string; email: string }

const BILLING_TYPE_LABEL: Record<string, string> = {
  CREDIT_CARD: 'cartão de crédito',
  PIX: 'PIX',
  BOLETO: 'boleto',
  UNDEFINED: 'a definir',
}

function usersLabel(seats: number) {
  return seats === 1 ? '1 usuário' : `${seats} usuários`
}

export function subscriptionDescription(planId: string, seats: number) {
  return `Smart CRM — plano ${planName(planId)} (${usersLabel(seats)})`
}

/** Tem assinatura no Asaas que não foi cancelada */
export function hasActiveSubscription(organization: Pick<Organization, 'asaasSubscriptionId' | 'canceledAt'>) {
  return !!organization.asaasSubscriptionId && !organization.canceledAt
}

/** Dados de cobrança que faltam para criar o cliente no Asaas */
export function missingBillingInfo(organization: Pick<Organization, 'billingName' | 'billingDocument' | 'billingEmail' | 'billingPhone'>) {
  const missing: string[] = []
  if (!organization.billingName) missing.push('nome ou razão social')
  if (!organization.billingDocument) missing.push('CPF ou CNPJ')
  if (!organization.billingEmail) missing.push('e-mail de cobrança')
  if (!organization.billingPhone) missing.push('telefone')
  return missing
}

@Injectable()
export class AsaasBillingService {
  /** Uma assinatura por vez por organização (evita duas criadas por clique duplo) */
  private readonly inFlight = new Set<string>()

  constructor(
    private prisma: PrismaService,
    private asaas: AsaasClient,
    private cache: SubscriptionCache,
    private config: ConfigService,
  ) {}

  private async organization(id: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id } })
    if (!organization) throw new NotFoundException('Organização não encontrada')
    return organization
  }

  private event(db: Pick<Prisma.TransactionClient, 'billingEvent'>, organizationId: string, kind: string, description: string, createdBy: string, data?: Prisma.InputJsonValue) {
    return db.billingEvent.create({ data: { organizationId, kind, description, createdBy, data } })
  }

  private async activeUsers(organizationId: string) {
    return this.prisma.user.count({ where: { organizationId, active: true } })
  }

  /** Assentos do plano novo não podem ficar abaixo dos usuários ativos */
  private async assertSeatsCoverActive(organizationId: string, seats: number) {
    const active = await this.activeUsers(organizationId)
    if (seats < active) {
      const extra = active - seats
      throw new BadRequestException(
        `Você tem ${usersLabel(active)} ativos. Desative ${extra === 1 ? '1 usuário' : `${extra} usuários`} antes ou escolha mais usuários.`,
      )
    }
  }

  /** Cliente no Asaas com os dados de cobrança: cria (e guarda o id) ou atualiza */
  async ensureAsaasCustomer(organizationId: string): Promise<string> {
    const organization = await this.organization(organizationId)
    const missing = missingBillingInfo(organization)
    if (missing.length > 0) throw new BadRequestException(`Preencha os dados de cobrança: ${missing.join(', ')}.`)

    const phone = (organization.billingPhone ?? '').replace(/\D/g, '')
    const input: AsaasCustomerInput = {
      name: organization.billingName ?? '',
      cpfCnpj: organization.billingDocument ?? '',
      email: organization.billingEmail ?? undefined,
      // Celular (11 dígitos) vai em mobilePhone; fixo, em phone
      ...(phone.length === 11 ? { mobilePhone: phone } : { phone }),
      externalReference: organization.id,
    }

    if (organization.asaasCustomerId) {
      await this.asaas.updateCustomer(organization.asaasCustomerId, input)
      return organization.asaasCustomerId
    }
    const customer = await this.asaas.createCustomer(input)
    await this.prisma.organization.update({ where: { id: organization.id }, data: { asaasCustomerId: customer.id } })
    return customer.id
  }

  /** Primeiro vencimento: hoje, ou o fim do teste / do período já pago, se ainda não chegou */
  firstDueDate(organization: Pick<Organization, 'subscriptionStatus' | 'trialEndsAt' | 'currentPeriodEnd'>, now: Date) {
    let base = now
    if (organization.subscriptionStatus === 'teste' && organization.trialEndsAt && organization.trialEndsAt > now) {
      base = organization.trialEndsAt
    }
    if (organization.subscriptionStatus === 'ativa' && organization.currentPeriodEnd && organization.currentPeriodEnd > now) {
      base = organization.currentPeriodEnd
    }
    return asaasDay(base)
  }

  private successUrl(): string | undefined {
    const base = this.config.get<string>('APP_PUBLIC_URL')?.trim().replace(/\/+$/, '')
    return base ? `${base}/assinatura/retorno` : undefined
  }

  /**
   * Cria a assinatura no Asaas e devolve a fatura da primeira cobrança (página do Asaas: o cartão nunca passa
   * por aqui). Não muda a situação: quem libera o acesso é o webhook de pagamento
   */
  async subscribe(actor: Actor, dto: SubscribeDto, now = new Date()) {
    const plan = findPlan(dto.planId)
    if (!plan) throw new BadRequestException('Plano inválido')
    const seats = dto.seats ?? plan.seats
    assertPlanSeats(plan.id, seats)
    const value = priceFor(plan.id, seats) ?? plan.price

    if (this.inFlight.has(actor.organizationId)) throw new ConflictException('Já existe uma assinatura sendo criada')
    this.inFlight.add(actor.organizationId)
    try {
      const organization = await this.organization(actor.organizationId)
      if (hasActiveSubscription(organization)) throw new ConflictException('Já existe uma assinatura ativa')
      await this.assertSeatsCoverActive(organization.id, seats)

      const customer = await this.ensureAsaasCustomer(organization.id)
      const successUrl = this.successUrl()
      const subscription = await this.asaas.createSubscription({
        customer,
        billingType: dto.billingType as AsaasBillingType,
        value,
        nextDueDate: this.firstDueDate(organization, now),
        cycle: 'MONTHLY',
        description: subscriptionDescription(plan.id, seats),
        externalReference: organization.id,
        ...(successUrl ? { callback: { successUrl, autoRedirect: true } } : {}),
      })

      await this.prisma.$transaction(async (tx) => {
        await tx.organization.update({
          where: { id: organization.id },
          data: {
            asaasSubscriptionId: subscription.id,
            billingType: dto.billingType,
            plan: plan.id,
            seats,
            monthlyPrice: value,
            canceledAt: null,
            cancelReason: null,
          },
        })
        await this.event(
          tx, organization.id, 'plano_alterado',
          `Assinatura criada: plano ${plan.name} (${usersLabel(seats)}), R$ ${value.toFixed(2).replace('.', ',')} por mês, ${BILLING_TYPE_LABEL[dto.billingType]}`,
          actor.email, { asaasSubscriptionId: subscription.id, plan: plan.id, seats, value, billingType: dto.billingType },
        )
      })
      this.cache.invalidate(organization.id)

      // A primeira cobrança nasce junto com a assinatura: a fatura dela é a página de pagamento
      const payments = await this.asaas.listSubscriptionPayments(subscription.id).catch(() => null)
      const first = [...(payments?.data ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]
      if (first) await upsertPayment(this.prisma, organization.id, first)
      return { redirectUrl: first?.invoiceUrl ?? null, subscriptionId: subscription.id }
    } finally {
      this.inFlight.delete(actor.organizationId)
    }
  }

  /** Muda plano e/ou usuários. Vale a partir da próxima cobrança, sem proporcional */
  async changeSubscription(actor: Actor, dto: ChangeSubscriptionDto) {
    const organization = await this.organization(actor.organizationId)
    if (!hasActiveSubscription(organization) || !organization.asaasSubscriptionId) {
      throw new BadRequestException('Você ainda não tem uma assinatura ativa')
    }
    const planId = dto.planId ?? organization.plan
    const plan = findPlan(planId)
    if (!plan) throw new BadRequestException('Plano inválido')
    const seats = dto.seats ?? (dto.planId && dto.planId !== organization.plan ? plan.seats : organization.seats)
    assertPlanSeats(plan.id, seats)
    await this.assertSeatsCoverActive(organization.id, seats)
    const value = priceFor(plan.id, seats) ?? plan.price
    if (plan.id === organization.plan && seats === organization.seats) throw new BadRequestException('Nada mudou')

    await this.asaas.updateSubscription(organization.asaasSubscriptionId, {
      value,
      description: subscriptionDescription(plan.id, seats),
      // A cobrança já gerada e ainda não paga também passa a ter o valor novo
      updatePendingPayments: true,
    })

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.organization.update({
        where: { id: organization.id },
        data: { plan: plan.id, seats, monthlyPrice: value },
      })
      await this.event(
        tx, organization.id, 'plano_alterado',
        `Plano ${planName(organization.plan)} (${usersLabel(organization.seats)}) → ${plan.name} (${usersLabel(seats)}), R$ ${value.toFixed(2).replace('.', ',')} a partir da próxima cobrança`,
        actor.email,
        { from: { plan: organization.plan, seats: organization.seats }, to: { plan: plan.id, seats, value } },
      )
      return result
    })
    this.cache.invalidate(organization.id)
    return { plan: updated.plan, seats: updated.seats, monthlyPrice: value }
  }

  /** Remove a assinatura no Asaas; o acesso segue até o fim do período e a tarefa diária passa para cancelada */
  async cancel(actor: Actor, dto: CancelSubscriptionDto, now = new Date()) {
    const organization = await this.organization(actor.organizationId)
    if (!hasActiveSubscription(organization) || !organization.asaasSubscriptionId) {
      throw new BadRequestException('Você não tem uma assinatura ativa para cancelar')
    }
    await this.asaas.deleteSubscription(organization.asaasSubscriptionId)
    const reason = dto.reason.trim()
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organization.id }, data: { canceledAt: now, cancelReason: reason } })
      await this.event(tx, organization.id, 'observacao', `Assinatura cancelada pelo cliente: ${reason}`, actor.email, {
        asaasSubscriptionId: organization.asaasSubscriptionId, accessUntil: organization.currentPeriodEnd?.toISOString() ?? null,
      })
    })
    this.cache.invalidate(organization.id)
    return { canceledAt: now, accessUntil: organization.subscriptionStatus === 'teste' ? organization.trialEndsAt : organization.currentPeriodEnd }
  }

  payments(organizationId: string) {
    return this.prisma.payment.findMany({
      where: { organizationId },
      orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 24,
      select: {
        id: true, asaasPaymentId: true, value: true, status: true, billingType: true, dueDate: true, paidAt: true,
        invoiceUrl: true, bankSlipUrl: true, description: true,
      },
    })
  }

  /**
   * Painel /admin: relê assinatura e cobranças no Asaas e corrige a situação local.
   * Cobrança paga cobre até um mês depois do vencimento; cobrança vencida sem pagamento depois deixa atrasada
   */
  async sync(organizationId: string, actorEmail: string, now = new Date()) {
    const organization = await this.organization(organizationId)
    if (!organization.asaasSubscriptionId) throw new BadRequestException('Esta imobiliária não tem assinatura no Asaas')
    const subscription = await this.asaas.getSubscription(organization.asaasSubscriptionId)
    const list = await this.asaas.listSubscriptionPayments(organization.asaasSubscriptionId)
    const payments: AsaasPayment[] = list.data ?? []

    let paidUntil: Date | null = null
    let latestPaidDue = ''
    let overdueAfterPaid = false
    for (const payment of payments) await upsertPayment(this.prisma, organization.id, payment)
    for (const payment of payments) {
      if (isPaidStatus(payment.status)) {
        paidUntil = laterDate(paidUntil, periodEndForPayment(payment))
        if ((payment.dueDate ?? '') > latestPaidDue) latestPaidDue = payment.dueDate ?? ''
      }
    }
    for (const payment of payments) {
      if (payment.status === 'OVERDUE' && (payment.dueDate ?? '') > latestPaidDue) overdueAfterPaid = true
    }

    const ended = subscription.deleted === true || subscription.status !== 'ACTIVE'
    const data: Prisma.OrganizationUpdateInput = { billingType: subscription.billingType }
    const currentPeriodEnd = laterDate(organization.currentPeriodEnd, paidUntil)
    if (currentPeriodEnd && currentPeriodEnd !== organization.currentPeriodEnd) data.currentPeriodEnd = currentPeriodEnd
    if (overdueAfterPaid && ['ativa', 'teste'].includes(organization.subscriptionStatus)) data.subscriptionStatus = 'atrasada'
    else if (!overdueAfterPaid && paidUntil && paidUntil > now && ['atrasada', 'bloqueada', 'teste'].includes(organization.subscriptionStatus)) {
      data.subscriptionStatus = 'ativa'
    }
    if (ended && !organization.canceledAt) {
      data.canceledAt = now
      data.cancelReason = 'Assinatura encerrada no Asaas'
    }

    const summary = {
      payments: payments.length,
      subscriptionStatus: subscription.status,
      paidUntil: paidUntil?.toISOString() ?? null,
      statusBefore: organization.subscriptionStatus,
      statusAfter: (data.subscriptionStatus as string | undefined) ?? organization.subscriptionStatus,
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organization.id }, data })
      await this.event(
        tx, organization.id, 'observacao',
        `Sincronizado com o Asaas: ${payments.length} cobranças, situação ${summary.statusBefore} → ${summary.statusAfter}`,
        actorEmail, summary,
      )
    })
    this.cache.invalidate(organization.id)
    return summary
  }
}
