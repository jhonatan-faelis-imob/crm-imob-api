import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizeEmail } from '../../common/utils/email'
import { AuthService } from '../auth/auth.service'
import { billingInfoData } from '../billing/billing-info'
import { assertPlanSeats, defaultSeatsFor, planName, priceFor, safePriceFor, TRIAL_DAYS } from '../billing/plans.config'
import { SubscriptionCache } from '../billing/subscription-cache'
import { nextStatus, periodEndAfterPayment } from '../billing/subscription-state'
import { seedFunnelStages } from '../organizations/seed-funnel'
import { generateTemporaryPassword } from '../users/users.service'
import {
  BlockOrganizationDto,
  CreateAdminOrganizationDto,
  ListAdminOrganizationsQueryDto,
  RegisterPaymentDto,
  UpdateAdminOrganizationDto,
} from './dto/admin-organization.dto'

const DAY_MS = 24 * 60 * 60 * 1000

export type BillingEventKind =
  | 'plano_alterado'
  | 'bloqueada'
  | 'desbloqueada'
  | 'teste_estendido'
  | 'pagamento_registrado'
  | 'observacao'

type Db = Prisma.TransactionClient | PrismaService

const LIST_SELECT = {
  id: true, name: true, slug: true, plan: true, seats: true, subscriptionStatus: true,
  monthlyPrice: true, currentPeriodEnd: true, trialEndsAt: true, createdAt: true,
  _count: { select: { leads: true, users: { where: { active: true } } } },
} satisfies Prisma.OrganizationSelect

const USER_SELECT = {
  id: true, name: true, email: true, role: true, phone: true, active: true, lastLogin: true, createdAt: true,
} satisfies Prisma.UserSelect

function dateOrNull(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined
  return value === null ? null : new Date(value)
}

function sameTime(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null)
}

const STATUS_LABEL: Record<string, string> = {
  teste: 'teste', ativa: 'ativa', atrasada: 'atrasada', bloqueada: 'bloqueada', cancelada: 'cancelada',
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
    private cache: SubscriptionCache,
  ) {}

  private event(db: Db, organizationId: string, kind: BillingEventKind, description: string, createdBy: string, data?: Prisma.InputJsonValue) {
    return db.billingEvent.create({ data: { organizationId, kind, description, createdBy, data } })
  }

  private async activeUsers(db: Db, organizationId: string) {
    return db.user.count({ where: { organizationId, active: true } })
  }

  private async findOrThrow(id: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id } })
    if (!organization) throw new NotFoundException('Imobiliária não encontrada')
    return organization
  }

  async list(query: ListAdminOrganizationsQueryDto) {
    const where: Prisma.OrganizationWhereInput = {}
    if (query.status) where.subscriptionStatus = query.status
    const search = query.search?.trim()
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ]
    }
    const organizations = await this.prisma.organization.findMany({ where, select: LIST_SELECT, orderBy: { name: 'asc' } })
    const lastAccess = await this.prisma.user.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: organizations.map((organization) => organization.id) } },
      _max: { lastLogin: true },
    })
    const lastByOrg = new Map(lastAccess.map((row) => [row.organizationId, row._max.lastLogin]))

    return organizations.map(({ _count, ...organization }) => ({
      ...organization,
      planName: planName(organization.plan),
      activeUsers: _count.users,
      leads: _count.leads,
      lastAccessAt: lastByOrg.get(organization.id) ?? null,
    }))
  }

  async detail(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: { select: USER_SELECT, orderBy: { name: 'asc' } },
        billingEvents: { orderBy: { createdAt: 'desc' }, take: 50 },
        payments: {
          orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
          take: 12,
          select: { id: true, asaasPaymentId: true, value: true, status: true, billingType: true, dueDate: true, paidAt: true, invoiceUrl: true },
        },
        _count: { select: { leads: true } },
      },
    })
    if (!organization) throw new NotFoundException('Imobiliária não encontrada')
    const { _count, ...rest } = organization
    return {
      ...rest,
      planName: planName(organization.plan),
      activeUsers: organization.users.filter((user) => user.active).length,
      leads: _count.leads,
      suggestedPrice: safePriceFor(organization.plan, organization.seats),
    }
  }

  /** Imobiliária e primeiro diretor numa transação; semeia o funil. Senha gerada volta uma única vez */
  async create(dto: CreateAdminOrganizationDto, actorEmail: string, now = new Date()) {
    const email = normalizeEmail(dto.directorEmail)
    const [slugTaken, emailTaken] = await Promise.all([
      this.prisma.organization.findUnique({ where: { slug: dto.slug }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
    ])
    if (slugTaken) throw new ConflictException('Slug já em uso')
    if (emailTaken) throw new ConflictException('E-mail do diretor já cadastrado')

    const seats = dto.seats ?? defaultSeatsFor(dto.plan)
    assertPlanSeats(dto.plan, seats)
    const status = dto.subscriptionStatus ?? 'teste'
    const trialEndsAt =
      dateOrNull(dto.trialEndsAt) ?? (status === 'teste' ? new Date(now.getTime() + TRIAL_DAYS * DAY_MS) : null)
    const temporaryPassword = dto.directorPassword ? undefined : generateTemporaryPassword()
    const passwordHash = await this.authService.hashPassword(dto.directorPassword ?? temporaryPassword ?? '')

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug,
          plan: dto.plan,
          seats,
          subscriptionStatus: status,
          trialEndsAt,
          currentPeriodEnd: dateOrNull(dto.currentPeriodEnd) ?? null,
          monthlyPrice: dto.monthlyPrice ?? priceFor(dto.plan, seats),
          notes: dto.notes?.trim() || null,
          ...billingInfoData(dto),
        },
      })
      await seedFunnelStages(tx, organization.id)
      const director = await tx.user.create({
        data: { organizationId: organization.id, name: dto.directorName.trim(), email, passwordHash, role: 'diretor' },
        select: USER_SELECT,
      })
      await this.event(
        tx, organization.id, 'observacao',
        `Imobiliária criada no plano ${planName(dto.plan)} com ${seats} ${seats === 1 ? 'usuário' : 'usuários'} (${STATUS_LABEL[status]})`,
        actorEmail, { plan: dto.plan, seats, status },
      )
      return { organization, director }
    })
    // Única vez que a senha gerada sai do servidor
    return temporaryPassword ? { ...result, temporaryPassword } : result
  }

  async update(id: string, dto: UpdateAdminOrganizationDto, actorEmail: string) {
    const current = await this.findOrThrow(id)
    if (dto.plan !== undefined || dto.seats !== undefined) assertPlanSeats(dto.plan ?? current.plan, dto.seats ?? current.seats)

    if (dto.seats !== undefined) {
      const active = await this.activeUsers(this.prisma, id)
      if (dto.seats < active) {
        throw new BadRequestException(
          `A imobiliária tem ${active} usuários ativos: os assentos não podem ficar abaixo disso. Desative usuários antes.`,
        )
      }
    }

    const data: Prisma.OrganizationUpdateInput = { ...billingInfoData(dto) }
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.plan !== undefined) data.plan = dto.plan
    if (dto.seats !== undefined) data.seats = dto.seats
    if (dto.subscriptionStatus !== undefined) data.subscriptionStatus = dto.subscriptionStatus
    if (dto.monthlyPrice !== undefined) data.monthlyPrice = dto.monthlyPrice
    const currentPeriodEnd = dateOrNull(dto.currentPeriodEnd)
    if (currentPeriodEnd !== undefined) data.currentPeriodEnd = currentPeriodEnd
    const trialEndsAt = dateOrNull(dto.trialEndsAt)
    if (trialEndsAt !== undefined) data.trialEndsAt = trialEndsAt
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada para atualizar')

    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({ where: { id }, data })
      const changed = new Set<string>()

      const planChanged = dto.plan !== undefined && dto.plan !== current.plan
      const seatsChanged = dto.seats !== undefined && dto.seats !== current.seats
      if (planChanged || seatsChanged) {
        await this.event(
          tx, id, 'plano_alterado',
          `Plano ${planName(current.plan)} (${current.seats}) → ${planName(organization.plan)} (${organization.seats})`,
          actorEmail, { from: { plan: current.plan, seats: current.seats }, to: { plan: organization.plan, seats: organization.seats } },
        )
      }
      if (dto.subscriptionStatus !== undefined && dto.subscriptionStatus !== current.subscriptionStatus) {
        const kind: BillingEventKind =
          dto.subscriptionStatus === 'bloqueada' ? 'bloqueada'
            : ['bloqueada', 'cancelada'].includes(current.subscriptionStatus) ? 'desbloqueada'
              : 'observacao'
        await this.event(
          tx, id, kind, `Situação ${current.subscriptionStatus} → ${dto.subscriptionStatus}`, actorEmail,
          { from: current.subscriptionStatus, to: dto.subscriptionStatus },
        )
      }
      if (trialEndsAt !== undefined && !sameTime(trialEndsAt, current.trialEndsAt)) {
        const extended = trialEndsAt && (!current.trialEndsAt || trialEndsAt > current.trialEndsAt)
        if (extended) {
          await this.event(tx, id, 'teste_estendido', `Teste até ${trialEndsAt.toISOString().slice(0, 10)}`, actorEmail, {
            from: current.trialEndsAt?.toISOString() ?? null, to: trialEndsAt.toISOString(),
          })
        } else changed.add('fim do teste')
      }
      if (dto.monthlyPrice !== undefined && Number(current.monthlyPrice ?? NaN) !== (dto.monthlyPrice ?? NaN)) changed.add('valor mensal')
      if (currentPeriodEnd !== undefined && !sameTime(currentPeriodEnd, current.currentPeriodEnd)) changed.add('vencimento')
      if (dto.name !== undefined && dto.name.trim() !== current.name) changed.add('nome')
      if (dto.notes !== undefined) changed.add('anotações')
      if ([dto.billingName, dto.billingDocument, dto.billingEmail, dto.billingPhone].some((value) => value !== undefined)) {
        changed.add('dados de cobrança')
      }
      if (changed.size > 0) {
        await this.event(tx, id, 'observacao', `Alterado: ${[...changed].join(', ')}`, actorEmail)
      }
      return organization
    })
    this.cache.invalidate(id)
    return updated
  }

  async block(id: string, dto: BlockOrganizationDto, actorEmail: string) {
    const current = await this.findOrThrow(id)
    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({ where: { id }, data: { subscriptionStatus: 'bloqueada' } })
      await this.event(tx, id, 'bloqueada', `Bloqueada: ${dto.reason.trim()}`, actorEmail, {
        from: current.subscriptionStatus, reason: dto.reason.trim(),
      })
      return organization
    })
    this.cache.invalidate(id)
    return updated
  }

  async unblock(id: string, dto: BlockOrganizationDto, actorEmail: string) {
    const current = await this.findOrThrow(id)
    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({ where: { id }, data: { subscriptionStatus: 'ativa' } })
      await this.event(tx, id, 'desbloqueada', `Desbloqueada: ${dto.reason.trim()}`, actorEmail, {
        from: current.subscriptionStatus, reason: dto.reason.trim(),
      })
      return organization
    })
    this.cache.invalidate(id)
    return updated
  }

  /** Empurra o vencimento um mês a partir do maior entre o vencimento atual e hoje, e deixa ativa */
  async registerPayment(id: string, dto: RegisterPaymentDto, actorEmail: string, now = new Date()) {
    const current = await this.findOrThrow(id)
    const currentPeriodEnd = periodEndAfterPayment(current.currentPeriodEnd, now)
    const updated = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({
        where: { id },
        data: { currentPeriodEnd, subscriptionStatus: 'ativa' },
      })
      const amount = dto.amount.toFixed(2).replace('.', ',')
      await this.event(
        tx, id, 'pagamento_registrado',
        `Pagamento de R$ ${amount} (${dto.method}). Vencimento: ${currentPeriodEnd.toISOString().slice(0, 10)}`,
        actorEmail,
        {
          amount: dto.amount, paidAt: dto.paidAt, method: dto.method, note: dto.note ?? null,
          previousPeriodEnd: current.currentPeriodEnd?.toISOString() ?? null, newPeriodEnd: currentPeriodEnd.toISOString(),
          previousStatus: current.subscriptionStatus,
        },
      )
      return organization
    })
    this.cache.invalidate(id)
    return updated
  }

  async summary() {
    const [byStatus, revenue] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['subscriptionStatus'], _count: { _all: true } }),
      this.prisma.organization.aggregate({ where: { subscriptionStatus: 'ativa' }, _sum: { monthlyPrice: true } }),
    ])
    const counts: Record<string, number> = { teste: 0, ativa: 0, atrasada: 0, bloqueada: 0, cancelada: 0 }
    for (const row of byStatus) counts[row.subscriptionStatus] = row._count._all
    return {
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      byStatus: counts,
      trials: counts.teste,
      monthlyRevenue: Number(revenue._sum.monthlyPrice ?? 0),
    }
  }

  /** Tarefa diária: teste vencido e ativa vencida viram atrasada; atrasada há mais de GRACE_DAYS vira bloqueada */
  async recalculateSubscriptionStatuses(actorEmail = 'sistema', now = new Date()) {
    const organizations = await this.prisma.organization.findMany({
      where: { subscriptionStatus: { in: ['teste', 'ativa', 'atrasada'] } },
      select: { id: true, name: true, subscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true, canceledAt: true },
    })
    const changes: { id: string; name: string; from: string; to: string; reason: string }[] = []
    for (const organization of organizations) {
      const next = nextStatus(organization, now)
      if (!next) continue
      await this.prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id: organization.id }, data: { subscriptionStatus: next.status } })
        await this.event(
          tx, organization.id, next.status === 'bloqueada' ? 'bloqueada' : 'observacao',
          `${next.reason}: ${organization.subscriptionStatus} → ${next.status}`, actorEmail,
          { from: organization.subscriptionStatus, to: next.status, automatic: true },
        )
      })
      this.cache.invalidate(organization.id)
      changes.push({ id: organization.id, name: organization.name, from: organization.subscriptionStatus, to: next.status, reason: next.reason })
    }
    return { checked: organizations.length, changed: changes.length, changes }
  }
}
