import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { billingInfoData } from './billing-info'
import { BillingInfoDto } from './dto/billing-info.dto'
import { PLANS, planName } from './plans.config'
import { isSuperAdmin } from './super-admin'
import { daysLeft, subscriptionWarning } from './subscription-state'

type BillingActor = { organizationId: string; email: string; role: string }

@Injectable()
export class BillingService {
  constructor(private prisma: PrismaService) {}

  plans() {
    return PLANS
  }

  /** Situação para a faixa do topo e a página /assinatura. Dados de cobrança só para diretor */
  async me(actor: BillingActor, now = new Date()) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: {
        plan: true, seats: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true, monthlyPrice: true,
        billingName: true, billingDocument: true, billingEmail: true, billingPhone: true,
        billingType: true, asaasSubscriptionId: true, canceledAt: true, cancelReason: true,
      },
    })
    if (!organization) throw new NotFoundException('Organização não encontrada')
    const seatsUsed = await this.prisma.user.count({ where: { organizationId: actor.organizationId, active: true } })
    const notice = subscriptionWarning(organization, now)
    const { billingName, billingDocument, billingEmail, billingPhone, ...subscription } = organization
    // Cobrança em aberto (atrasada ou pendente) com fatura: o link do aviso de atraso
    const openPayment = await this.prisma.payment.findFirst({
      where: { organizationId: actor.organizationId, status: { in: ['OVERDUE', 'PENDING'] }, invoiceUrl: { not: null } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      select: { invoiceUrl: true, dueDate: true, value: true, status: true },
    })

    return {
      plan: subscription.plan,
      planName: planName(subscription.plan),
      seats: subscription.seats,
      seatsUsed,
      status: subscription.subscriptionStatus,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      daysLeft: daysLeft(organization, now),
      monthlyPrice: subscription.monthlyPrice,
      warning: notice?.warning ?? null,
      warningLevel: notice?.level ?? null,
      billingType: subscription.billingType,
      hasSubscription: !!subscription.asaasSubscriptionId && !subscription.canceledAt,
      canceledAt: subscription.canceledAt,
      cancelReason: subscription.cancelReason,
      openPayment,
      isSuperAdmin: isSuperAdmin(actor.email),
      billing: actor.role === 'diretor' ? { billingName, billingDocument, billingEmail, billingPhone } : null,
    }
  }

  /** Só os dados de cobrança (diretor) */
  async updateBillingInfo(organizationId: string, dto: BillingInfoDto) {
    const data = billingInfoData(dto)
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada para atualizar')
    return this.prisma.organization.update({
      where: { id: organizationId },
      data,
      select: { billingName: true, billingDocument: true, billingEmail: true, billingPhone: true },
    })
  }
}
