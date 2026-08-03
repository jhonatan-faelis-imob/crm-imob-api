import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateGoalDto } from './dto/create-goal.dto'
import { CreateDailyEntryDto } from './dto/create-daily-entry.dto'

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateGoalDto) {
    // Calcular funil se for meta individual com VGV
    let funnelData = {}
    if (dto.targetVgv && dto.avgTicket && dto.avgTicket > 0) {
      const units = Math.ceil(dto.targetVgv / dto.avgTicket)
      funnelData = {
        goalUnits: units,
        goalClosings: units,
        goalAppointments: units * 3,
        goalSimulations: units * 6,
        goalQualifications: units * 12,
        goalProspects: units * 36,
        goalCalls: units * 180,
      }
    }

    return this.prisma.goal.create({
      data: {
        ...dto,
        ...funnelData,
        organizationId,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
      },
    })
  }

  async findAll(
    organizationId: string,
    requestingUser: { id: string; role: string },
  ) {
    const where: Record<string, unknown> = { organizationId, active: true }

    if (requestingUser.role === 'corretor') {
      where.OR = [
        { userId: requestingUser.id },
        { userId: null, teamId: null },
      ]
    }

    return this.prisma.goal.findMany({
      where,
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { dailyEntries: true } },
      },
      orderBy: { periodStart: 'desc' },
    })
  }

  async findById(organizationId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id, organizationId },
      include: {
        team: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
        dailyEntries: { orderBy: { date: 'desc' } },
      },
    })
    if (!goal) throw new NotFoundException('Meta não encontrada')
    return goal
  }

  async upsertDailyEntry(
    organizationId: string,
    goalId: string,
    userId: string,
    dto: CreateDailyEntryDto,
  ) {
    await this.prisma.goal.findFirstOrThrow({ where: { id: goalId, organizationId } })

    return this.prisma.goalDailyEntry.upsert({
      where: { goalId_userId_date: { goalId, userId, date: new Date(dto.date) } },
      create: { ...dto, goalId, userId, organizationId, date: new Date(dto.date) },
      update: { ...dto },
    })
  }

  async getDailyEntries(organizationId: string, goalId: string) {
    await this.prisma.goal.findFirstOrThrow({ where: { id: goalId, organizationId } })
    return this.prisma.goalDailyEntry.findMany({
      where: { goalId },
      orderBy: { date: 'desc' },
    })
  }

  async updateProgress(organizationId: string, goalId: string) {
    // Recalcular progresso com base nas vendas do período
    const goal = await this.prisma.goal.findFirstOrThrow({
      where: { id: goalId, organizationId },
    })

    const sales = await this.prisma.sale.aggregate({
      where: {
        organizationId,
        ...(goal.userId ? { brokerId: goal.userId } : {}),
        ...(goal.teamId ? { teamId: goal.teamId } : {}),
        soldAt: { gte: goal.periodStart, lte: goal.periodEnd },
      },
      _sum: { saleValue: true },
      _count: { id: true },
    })

    return this.prisma.goal.update({
      where: { id: goalId },
      data: {
        currentVgv: sales._sum.saleValue ?? 0,
        currentUnits: sales._count.id,
      },
    })
  }

  async update(
    organizationId: string,
    id: string,
    dto: Partial<CreateGoalDto>,
    requestingUser: { id: string; role: string; teamId: string | null },
  ) {
    const goal = await this.prisma.goal.findFirstOrThrow({ where: { id, organizationId } })

    const canEdit =
      ['diretor', 'gerente'].includes(requestingUser.role) ||
      (requestingUser.role === 'coordenador' && goal.teamId === requestingUser.teamId) ||
      goal.userId === requestingUser.id

    if (!canEdit) throw new ForbiddenException('Sem permissão para editar esta meta')

    let funnelData = {}
    const targetVgv = dto.targetVgv ?? Number(goal.targetVgv)
    const avgTicket = dto.avgTicket ?? Number(goal.avgTicket)
    if (targetVgv && avgTicket && avgTicket > 0) {
      const units = Math.ceil(targetVgv / avgTicket)
      funnelData = {
        goalUnits: units,
        goalClosings: units,
        goalAppointments: units * 3,
        goalSimulations: units * 6,
        goalQualifications: units * 12,
        goalProspects: units * 36,
        goalCalls: units * 180,
      }
    }

    return this.prisma.goal.update({
      where: { id },
      data: {
        ...dto,
        ...funnelData,
        ...(dto.periodStart && { periodStart: new Date(dto.periodStart) }),
        ...(dto.periodEnd && { periodEnd: new Date(dto.periodEnd) }),
      },
    })
  }

  async deactivate(organizationId: string, id: string) {
    await this.prisma.goal.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.goal.update({ where: { id }, data: { active: false } })
  }
}
