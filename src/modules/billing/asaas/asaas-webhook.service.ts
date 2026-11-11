import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { SubscriptionCache } from '../subscription-cache'
import { asaasDate, laterDate, periodEndForPayment, safePayload, isPaidStatus, upsertPayment } from './asaas-payments'
import {
  DELINQUENT_EVENTS,
  PAID_EVENTS,
  PAYMENT_SYNC_EVENTS,
  SUBSCRIPTION_END_EVENTS,
  SUBSCRIPTION_SYNC_EVENTS,
  type AsaasPayment,
  type AsaasSubscription,
  type AsaasWebhookEvent,
} from './asaas.types'

export const ASAAS_PROVIDER = 'asaas'
const SYSTEM = 'webhook Asaas'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Db = Prisma.TransactionClient
type Outcome = { status: 'ok' | 'ignorado'; message: string; organizationId: string | null }

/** Token do cabeçalho asaas-access-token contra ASAAS_WEBHOOK_TOKEN, em tempo constante. Sem token configurado: recusa */
export function isValidWebhookToken(received: string | string[] | undefined, expected: string | undefined): boolean {
  if (!expected || typeof received !== 'string' || received.length === 0) return false
  // O hash iguala os tamanhos antes do timingSafeEqual
  const a = createHash('sha256').update(received).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function includes<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

/** Erro de chave única do Prisma (evento já gravado por outra entrega simultânea) */
function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

@Injectable()
export class AsaasWebhookService {
  private readonly logger = new Logger(AsaasWebhookService.name)

  constructor(
    private prisma: PrismaService,
    private cache: SubscriptionCache,
    private config: ConfigService,
  ) {}

  isAuthentic(token: string | string[] | undefined) {
    return isValidWebhookToken(token, this.config.get<string>('ASAAS_WEBHOOK_TOKEN'))
  }

  /**
   * Processa um evento uma única vez (WebhookDelivery único por provedor + id do evento).
   * Já processado (ok ou ignorado): não faz nada. Entrega anterior com erro: processa de novo (o Asaas repete após 500)
   */
  async handle(body: AsaasWebhookEvent): Promise<{ duplicate: boolean; status: string }> {
    const eventId = typeof body?.id === 'string' ? body.id : ''
    const event = typeof body?.event === 'string' ? body.event : ''
    if (!eventId || !event) return { duplicate: false, status: 'ignorado' }

    const key = { provider_eventId: { provider: ASAAS_PROVIDER, eventId } }
    const existing = await this.prisma.webhookDelivery.findUnique({ where: key, select: { id: true, status: true } })
    if (existing && existing.status !== 'erro') return { duplicate: true, status: existing.status }

    const payload = safePayload(body)
    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Grava antes de processar: outra entrega simultânea do mesmo evento esbarra na chave única
        if (!existing) {
          await tx.webhookDelivery.create({ data: { provider: ASAAS_PROVIDER, eventId, event, status: 'ok', payload } })
        }
        const result = await this.process(tx, body)
        await tx.webhookDelivery.update({
          where: key,
          data: { status: result.status, message: result.message, organizationId: result.organizationId, payload },
        })
        return result
      })
      if (outcome.organizationId) this.cache.invalidate(outcome.organizationId)
      return { duplicate: false, status: outcome.status }
    } catch (error) {
      if (isUniqueViolation(error)) return { duplicate: true, status: 'ok' }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'erro desconhecido'
      this.logger.error(`Webhook Asaas ${event} (${eventId}) falhou: ${message}`)
      await this.prisma.webhookDelivery.upsert({
        where: key,
        create: { provider: ASAAS_PROVIDER, eventId, event, status: 'erro', message, payload },
        update: { status: 'erro', message, payload },
      })
      throw error
    }
  }

  /** Organização por externalReference e, sem ela, pelo id da assinatura ou do cliente */
  private async findOrganization(db: Db, refs: { externalReference?: string | null; subscription?: string | null; customer?: string | null }) {
    const select = {
      id: true, name: true, subscriptionStatus: true, currentPeriodEnd: true, trialEndsAt: true,
      asaasSubscriptionId: true, asaasCustomerId: true, canceledAt: true, billingType: true,
    } satisfies Prisma.OrganizationSelect
    if (refs.externalReference && UUID.test(refs.externalReference)) {
      const byReference = await db.organization.findUnique({ where: { id: refs.externalReference }, select })
      if (byReference) return byReference
    }
    if (refs.subscription) {
      const bySubscription = await db.organization.findFirst({ where: { asaasSubscriptionId: refs.subscription }, select })
      if (bySubscription) return bySubscription
    }
    if (refs.customer) {
      const byCustomer = await db.organization.findFirst({ where: { asaasCustomerId: refs.customer }, select })
      if (byCustomer) return byCustomer
    }
    return null
  }

  private async process(db: Db, body: AsaasWebhookEvent): Promise<Outcome> {
    const event = body.event
    if (event.startsWith('PAYMENT_') && body.payment) return this.processPayment(db, event, body.payment)
    if (event.startsWith('SUBSCRIPTION_') && body.subscription) return this.processSubscription(db, event, body.subscription)
    return { status: 'ignorado', message: `Evento não tratado: ${event}`, organizationId: null }
  }

  private async processPayment(db: Db, event: string, payment: AsaasPayment): Promise<Outcome> {
    const tracked = includes(PAID_EVENTS, event) || includes(DELINQUENT_EVENTS, event) || includes(PAYMENT_SYNC_EVENTS, event)
    if (!tracked) return { status: 'ignorado', message: `Evento não tratado: ${event}`, organizationId: null }

    const organization = await this.findOrganization(db, {
      externalReference: payment.externalReference,
      subscription: payment.subscription,
      customer: payment.customer,
    })
    if (!organization) return { status: 'ignorado', message: 'Organização não encontrada para a cobrança', organizationId: null }

    // PAYMENT_DELETED: o objeto pode vir com o status antigo; marca como removida no espelho local
    const previousStatus = await upsertPayment(db, organization.id, payment, event === 'PAYMENT_DELETED' ? 'DELETED' : undefined)

    if (includes(PAID_EVENTS, event)) {
      const periodEnd = laterDate(organization.currentPeriodEnd, periodEndForPayment(payment))
      await db.organization.update({
        where: { id: organization.id },
        data: { subscriptionStatus: 'ativa', currentPeriodEnd: periodEnd },
      })
      // CONFIRMED e depois RECEIVED da mesma cobrança: um evento de pagamento só
      if (!isPaidStatus(previousStatus)) {
        await db.billingEvent.create({
          data: {
            organizationId: organization.id,
            kind: 'pagamento_registrado',
            description: `Pagamento de R$ ${Number(payment.value).toFixed(2).replace('.', ',')} confirmado pelo Asaas. Vencimento: ${periodEnd?.toISOString().slice(0, 10) ?? '—'}`,
            createdBy: SYSTEM,
            data: { asaasPaymentId: payment.id, event, value: payment.value, dueDate: payment.dueDate ?? null, paidAt: asaasDate(payment.paymentDate ?? payment.clientPaymentDate)?.toISOString() ?? null },
          },
        })
      }
      return { status: 'ok', message: `${event}: ativa até ${periodEnd?.toISOString().slice(0, 10) ?? '—'}`, organizationId: organization.id }
    }

    if (includes(DELINQUENT_EVENTS, event)) {
      // Bloqueada e cancelada continuam como estão; a tarefa diária bloqueia depois da tolerância
      if (['ativa', 'teste'].includes(organization.subscriptionStatus)) {
        await db.organization.update({ where: { id: organization.id }, data: { subscriptionStatus: 'atrasada' } })
        await db.billingEvent.create({
          data: {
            organizationId: organization.id,
            kind: 'observacao',
            description: `${event === 'PAYMENT_OVERDUE' ? 'Cobrança vencida' : 'Cobrança estornada'} no Asaas: ${organization.subscriptionStatus} → atrasada`,
            createdBy: SYSTEM,
            data: { asaasPaymentId: payment.id, event },
          },
        })
        return { status: 'ok', message: `${event}: atrasada`, organizationId: organization.id }
      }
      return { status: 'ok', message: `${event}: situação ${organization.subscriptionStatus} mantida`, organizationId: organization.id }
    }

    return { status: 'ok', message: `${event}: cobrança atualizada`, organizationId: organization.id }
  }

  private async processSubscription(db: Db, event: string, subscription: AsaasSubscription): Promise<Outcome> {
    const tracked = includes(SUBSCRIPTION_SYNC_EVENTS, event) || includes(SUBSCRIPTION_END_EVENTS, event)
    if (!tracked) return { status: 'ignorado', message: `Evento não tratado: ${event}`, organizationId: null }

    const organization = await this.findOrganization(db, {
      externalReference: subscription.externalReference,
      subscription: subscription.id,
      customer: subscription.customer,
    })
    if (!organization) return { status: 'ignorado', message: 'Organização não encontrada para a assinatura', organizationId: null }
    const isCurrent = !organization.asaasSubscriptionId || organization.asaasSubscriptionId === subscription.id

    if (includes(SUBSCRIPTION_SYNC_EVENTS, event)) {
      if (!isCurrent) return { status: 'ignorado', message: 'Assinatura diferente da atual', organizationId: organization.id }
      await db.organization.update({
        where: { id: organization.id },
        data: { asaasSubscriptionId: subscription.id, billingType: subscription.billingType ?? organization.billingType },
      })
      return { status: 'ok', message: `${event}: assinatura ${subscription.id}`, organizationId: organization.id }
    }

    // Encerrada no Asaas sem cancelamento pelo sistema: registra o cancelamento (acesso segue até o fim do período)
    if (organization.asaasSubscriptionId === subscription.id && !organization.canceledAt) {
      await db.organization.update({
        where: { id: organization.id },
        data: { canceledAt: new Date(), cancelReason: 'Assinatura encerrada no Asaas' },
      })
      await db.billingEvent.create({
        data: { organizationId: organization.id, kind: 'observacao', description: `Assinatura encerrada no Asaas (${event})`, createdBy: SYSTEM, data: { asaasSubscriptionId: subscription.id, event } },
      })
      return { status: 'ok', message: `${event}: cancelamento registrado`, organizationId: organization.id }
    }
    return { status: 'ok', message: `${event}: nada a mudar`, organizationId: organization.id }
  }

  /** Painel /admin/webhooks */
  recent(limit = 100) {
    return this.prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  }
}

