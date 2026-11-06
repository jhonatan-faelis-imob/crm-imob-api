import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Goal, Prisma } from '@prisma/client'
import { HIERARCHY } from '../../common/guards/roles.guard'
import {
  businessDayBounds,
  daysBetween,
  toDateOnly,
  todayInBusinessTimeZone,
} from '../../common/utils/date'
import { PrismaService } from '../../prisma/prisma.service'
import { ConversionRatesDto, CreateGoalDto } from './dto/create-goal.dto'
import { UpdateGoalDto } from './dto/update-goal.dto'
import { CreateDailyEntryDto } from './dto/create-daily-entry.dto'
import { computeGoalProgress, computeTypedProgress } from './goal-progress'

type RequestingUser = { id: string; role: string; teamId: string | null }
type GoalScope = CreateGoalDto['scope']

const FUNNEL_KEYS = ['calls', 'prospects', 'qualifications', 'simulations', 'appointments', 'closings'] as const
type FunnelCounts = Record<(typeof FUNNEL_KEYS)[number], number>

const DEFAULT_CONVERSION_RATES = {
  appointmentsPerClosing: 3,
  simulationsPerAppointment: 2,
  qualificationsPerSimulation: 2,
  prospectsPerQualification: 3,
  callsPerProspect: 5,
}

function isAtLeast(role: string, minimum: string) {
  return (HIERARCHY[role] ?? 0) >= HIERARCHY[minimum]
}

function goalScope(goal: Pick<Goal, 'userId' | 'teamId'>): GoalScope {
  if (goal.userId) return 'individual'
  return goal.teamId ? 'equipe' : 'organizacao'
}

function percent(current: number, target: number) {
  return target > 0 ? Math.round((current / target) * 1000) / 10 : 0
}

// Aplica as fontes em ordem, ignorando chaves vazias: o DTO traz os campos não enviados
// como undefined, que num spread apagariam o padrão
function resolveRates(...sources: unknown[]) {
  const rates = { ...DEFAULT_CONVERSION_RATES }
  for (const source of sources as (ConversionRatesDto | null | undefined)[]) {
    for (const key of Object.keys(rates) as (keyof typeof rates)[]) {
      const value = source?.[key]
      if (value) rates[key] = Number(value)
    }
  }
  return rates
}

// O funil só existe em meta individual de VGV; as demais limpam o que houver
function funnelTargets(
  scope: GoalScope,
  type: string,
  targetVgv: number | null | undefined,
  avgTicket: number | null | undefined,
  rates: typeof DEFAULT_CONVERSION_RATES,
) {
  if (scope === 'individual' && type === 'vgv' && targetVgv && avgTicket && avgTicket > 0) {
    const units = Math.ceil(targetVgv / avgTicket)
    const appointments = Math.ceil(units * rates.appointmentsPerClosing)
    const simulations = Math.ceil(appointments * rates.simulationsPerAppointment)
    const qualifications = Math.ceil(simulations * rates.qualificationsPerSimulation)
    const prospects = Math.ceil(qualifications * rates.prospectsPerQualification)
    return {
      goalUnits: units,
      goalClosings: units,
      goalAppointments: appointments,
      goalSimulations: simulations,
      goalQualifications: qualifications,
      goalProspects: prospects,
      goalCalls: Math.ceil(prospects * rates.callsPerProspect),
    }
  }
  return {
    goalUnits: null,
    goalClosings: null,
    goalAppointments: null,
    goalSimulations: null,
    goalQualifications: null,
    goalProspects: null,
    goalCalls: null,
  }
}

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateGoalDto, requestingUser: RequestingUser) {
    const { scope, userId, teamId, conversionRates, ...data } = dto
    const owner = await this.resolveOwner(organizationId, scope, { userId, teamId }, requestingUser)
    const rates = resolveRates(conversionRates)

    const goal = await this.prisma.goal.create({
      data: {
        ...data,
        ...owner,
        ...funnelTargets(scope, dto.type, dto.targetVgv, dto.avgTicket, rates),
        ...(scope === 'individual' && { conversionRates: rates }),
        organizationId,
        periodStart: toDateOnly(dto.periodStart),
        periodEnd: toDateOnly(dto.periodEnd),
      },
    })

    return this.recalculateGoal(goal)
  }

  async findAll(organizationId: string, requestingUser: RequestingUser) {
    return this.prisma.goal.findMany({
      where: { organizationId, active: true, ...this.visibilityWhere(requestingUser) },
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { dailyEntries: true } },
      },
      orderBy: { periodStart: 'desc' },
    })
  }

  async findById(organizationId: string, id: string, requestingUser: RequestingUser) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId, ...this.visibilityWhere(requestingUser) },
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
        dailyEntries: { orderBy: { date: 'desc' } },
      },
    })
    if (!goal) throw new NotFoundException('Meta não encontrada')
    return goal
  }

  async getSummary(organizationId: string, id: string, requestingUser: RequestingUser) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId, ...this.visibilityWhere(requestingUser) },
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    })
    if (!goal) throw new NotFoundException('Meta não encontrada')

    const today = todayInBusinessTimeZone()
    const todayDate = toDateOnly(today)
    const daysTotal = daysBetween(goal.periodStart, goal.periodEnd) + 1
    // Hoje conta como dia restante: é o dia em que o corretor ainda pode agir
    const daysElapsed = Math.min(Math.max(daysBetween(goal.periodStart, todayDate), 0), daysTotal)
    const daysLeft = daysTotal - daysElapsed

    const targetVgv = Number(goal.targetVgv ?? 0)
    const currentVgv = Number(goal.currentVgv)
    const targetUnits = goal.goalUnits ?? 0

    const progress = await computeTypedProgress(this.prisma, goal)
    const expectedPercent = Math.round((daysElapsed / daysTotal) * 1000) / 10
    const actualPercent = progress.percent
    let paceStatus = 'atrasado'
    if (actualPercent >= expectedPercent + 5) paceStatus = 'adiantado'
    else if (actualPercent >= expectedPercent - 10) paceStatus = 'no_ritmo'

    const summary = {
      goal,
      period: {
        start: goal.periodStart.toISOString().slice(0, 10),
        end: goal.periodEnd.toISOString().slice(0, 10),
        daysTotal,
        daysElapsed,
        daysLeft,
      },
      vgv: { target: targetVgv, current: currentVgv, percent: percent(currentVgv, targetVgv) },
      units: {
        target: targetUnits,
        current: goal.currentUnits,
        percent: percent(goal.currentUnits, targetUnits),
      },
      progress,
      pace: { expectedPercent, actualPercent, status: paceStatus },
    }

    if (goalScope(goal) !== 'individual' || goal.goalCalls === null) return summary

    const [entries, todayEntry] = await Promise.all([
      this.prisma.goalDailyEntry.aggregate({
        where: { goalId: id, date: { gte: goal.periodStart, lte: goal.periodEnd } },
        _sum: {
          calls: true,
          prospects: true,
          qualifications: true,
          simulations: true,
          appointments: true,
          closings: true,
        },
      }),
      this.prisma.goalDailyEntry.findFirst({ where: { goalId: id, date: todayDate } }),
    ])

    const targets: FunnelCounts = {
      calls: goal.goalCalls ?? 0,
      prospects: goal.goalProspects ?? 0,
      qualifications: goal.goalQualifications ?? 0,
      simulations: goal.goalSimulations ?? 0,
      appointments: goal.goalAppointments ?? 0,
      closings: goal.goalClosings ?? 0,
    }
    const realized = {} as FunnelCounts
    const remaining = {} as FunnelCounts
    const dailyTarget = {} as FunnelCounts
    for (const key of FUNNEL_KEYS) {
      realized[key] = entries._sum[key] ?? 0
      remaining[key] = Math.max(targets[key] - realized[key], 0)
      dailyTarget[key] = Math.ceil(remaining[key] / Math.max(daysLeft, 1))
    }

    return {
      ...summary,
      funnel: { realized, target: targets, remaining, dailyTarget },
      today: todayEntry,
    }
  }

  async getAutoFill(organizationId: string, userId: string, date?: string) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Use a data no formato YYYY-MM-DD')
    }
    const day = date ?? todayInBusinessTimeZone()
    const { start, end } = businessDayBounds(day)
    const period = { gte: start, lte: end }

    const [calls, prospects, stageMoves, closings] = await Promise.all([
      this.prisma.interaction.count({
        where: { organizationId, userId, type: { in: ['ligacao', 'whatsapp'] }, occurredAt: period },
      }),
      this.prisma.lead.count({ where: { organizationId, ownerId: userId, createdAt: period } }),
      // distinct: mover o mesmo card duas vezes para a etapa conta um lead só
      this.prisma.leadStageHistory.findMany({
        where: {
          organizationId,
          changedBy: userId,
          createdAt: period,
          toStageName: { in: ['qualificacao', 'simulacao', 'agendamento'] },
        },
        distinct: ['leadId', 'toStageName'],
        select: { toStageName: true },
      }),
      this.prisma.sale.count({
        where: { organizationId, brokerId: userId, status: { not: 'cancelado' }, soldAt: toDateOnly(day) },
      }),
    ])

    const countStage = (name: string) => stageMoves.filter((move) => move.toStageName === name).length

    return {
      date: day,
      calls,
      prospects,
      qualifications: countStage('qualificacao'),
      simulations: countStage('simulacao'),
      appointments: countStage('agendamento'),
      closings,
    }
  }

  async upsertDailyEntry(
    organizationId: string,
    goalId: string,
    requestingUser: { id: string; role: string },
    dto: CreateDailyEntryDto,
  ) {
    const goal = await this.prisma.goal.findFirst({ where: { id: goalId, organizationId } })
    if (!goal) throw new NotFoundException('Meta não encontrada')
    if (!goal.userId) throw new BadRequestException('Só meta individual aceita registro diário')

    const { date, userId, ...counts } = dto
    const isOwner = goal.userId === requestingUser.id
    if (!isOwner && !isAtLeast(requestingUser.role, 'gerente')) {
      throw new ForbiddenException('Só o dono da meta pode registrar atividades')
    }
    if (userId && userId !== goal.userId) {
      throw new BadRequestException('O registro precisa ser do dono da meta')
    }

    const entryDate = toDateOnly(date)
    if (entryDate > toDateOnly(todayInBusinessTimeZone())) {
      throw new BadRequestException('Não é possível registrar atividades em datas futuras')
    }
    // Fora do período o registro seria salvo, mas nunca somado no funil
    if (entryDate < goal.periodStart || entryDate > goal.periodEnd) {
      throw new BadRequestException('A data está fora do período da meta')
    }

    return this.prisma.goalDailyEntry.upsert({
      where: { goalId_userId_date: { goalId, userId: goal.userId, date: entryDate } },
      create: { ...counts, goalId, userId: goal.userId, organizationId, date: entryDate },
      update: counts,
    })
  }

  async getDailyEntries(organizationId: string, goalId: string, requestingUser: RequestingUser) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, organizationId, ...this.visibilityWhere(requestingUser) },
    })
    if (!goal) throw new NotFoundException('Meta não encontrada')

    return this.prisma.goalDailyEntry.findMany({
      where: { goalId },
      orderBy: { date: 'desc' },
    })
  }

  async updateProgress(organizationId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirstOrThrow({
      where: { id: goalId, organizationId },
    })

    return this.recalculateGoal(goal)
  }

  async recalculateForSale(
    organizationId: string,
    sale: { soldAt: Date; brokerId: string | null; teamId: string | null },
  ) {
    const goals = await this.prisma.goal.findMany({
      where: {
        organizationId,
        active: true,
        periodStart: { lte: sale.soldAt },
        periodEnd: { gte: sale.soldAt },
        OR: [
          { userId: null, teamId: null },
          ...(sale.brokerId ? [{ userId: sale.brokerId }] : []),
          ...(sale.teamId ? [{ teamId: sale.teamId }] : []),
        ],
      },
    })

    await Promise.all(goals.map((goal) => this.recalculateGoal(goal)))
  }

  // Recalcular progresso com base nas vendas do período
  private async recalculateGoal(goal: Goal) {
    return this.prisma.goal.update({
      where: { id: goal.id },
      data: await computeGoalProgress(this.prisma, goal),
    })
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateGoalDto,
    requestingUser: RequestingUser,
  ) {
    const goal = await this.prisma.goal.findFirstOrThrow({ where: { id, organizationId } })

    const canEdit =
      isAtLeast(requestingUser.role, 'gerente') ||
      (requestingUser.role === 'coordenador' && !!goal.teamId && goal.teamId === requestingUser.teamId) ||
      goal.userId === requestingUser.id

    if (!canEdit) throw new ForbiddenException('Sem permissão para editar esta meta')

    const { scope: nextScope, userId, teamId, periodStart, periodEnd, conversionRates, ...data } = dto
    const scope = nextScope ?? goalScope(goal)
    const owner = await this.resolveOwner(organizationId, scope, { userId, teamId }, requestingUser, goal)

    const targetVgv = dto.targetVgv ?? Number(goal.targetVgv)
    const avgTicket = dto.avgTicket ?? Number(goal.avgTicket)
    const rates = resolveRates(goal.conversionRates, conversionRates)

    const updated = await this.prisma.goal.update({
      where: { id },
      data: {
        ...data,
        ...owner,
        ...funnelTargets(scope, dto.type ?? goal.type, targetVgv, avgTicket, rates),
        ...(scope === 'individual' && { conversionRates: rates }),
        ...(periodStart && { periodStart: toDateOnly(periodStart) }),
        ...(periodEnd && { periodEnd: toDateOnly(periodEnd) }),
      },
    })

    return this.recalculateGoal(updated)
  }

  private visibilityWhere(user: RequestingUser): Prisma.GoalWhereInput {
    if (isAtLeast(user.role, 'gerente')) return {}

    const organizationGoal = { userId: null, teamId: null }
    const ownGoals = { userId: user.id }
    if (!user.teamId) return { OR: [organizationGoal, ownGoals] }

    const teamGoal = { teamId: user.teamId, userId: null }
    return {
      OR: [
        organizationGoal,
        teamGoal,
        user.role === 'coordenador' ? { user: { teamId: user.teamId } } : ownGoals,
      ],
    }
  }

  // Valida quem pode criar a meta nesse escopo e devolve o dono dela. Em edição, o dono
  // atual é mantido: editar a meta de alguém não pode transferi-la para quem editou.
  private async resolveOwner(
    organizationId: string,
    scope: GoalScope,
    requested: { userId?: string; teamId?: string },
    user: RequestingUser,
    current?: Goal,
  ) {
    if (scope === 'organizacao') {
      if (!isAtLeast(user.role, 'gerente')) {
        throw new ForbiddenException('Só gerente ou superior pode criar meta da organização')
      }
      return { userId: null, teamId: null }
    }

    if (scope === 'equipe') {
      if (!isAtLeast(user.role, 'coordenador')) {
        throw new ForbiddenException('Só coordenador ou superior pode criar meta de equipe')
      }
      const teamId = requested.teamId ?? current?.teamId ?? user.teamId
      if (!teamId) throw new BadRequestException('Informe a equipe da meta')
      if (user.role === 'coordenador' && teamId !== user.teamId) {
        throw new ForbiddenException('Coordenador só pode criar meta da própria equipe')
      }
      const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } })
      if (!team) throw new NotFoundException('Equipe não encontrada')
      return { userId: null, teamId }
    }

    const userId = requested.userId ?? current?.userId ?? user.id
    if (userId !== user.id) {
      if (!isAtLeast(user.role, 'coordenador')) {
        throw new ForbiddenException('Você só pode criar metas individuais para si mesmo')
      }
      const owner = await this.prisma.user.findFirst({ where: { id: userId, organizationId } })
      if (!owner) throw new NotFoundException('Usuário não encontrado')
      if (user.role === 'coordenador' && owner.teamId !== user.teamId) {
        throw new ForbiddenException('Coordenador só pode criar meta para membros da própria equipe')
      }
    }
    return { userId, teamId: null }
  }

  async deactivate(organizationId: string, id: string) {
    await this.prisma.goal.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.goal.update({ where: { id }, data: { active: false } })
  }
}
