import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common'
import { normalizeStageName } from '../../common/utils/stage'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { QueryLeadDto } from './dto/query-lead.dto'

const TERMINAL_STATUSES = ['ganho', 'perdido']

function statusForStage(stageName: string, currentStatus: string) {
  const name = normalizeStageName(stageName)
  if (TERMINAL_STATUSES.includes(name)) return name
  return TERMINAL_STATUSES.includes(currentStatus) ? 'novo' : currentStatus
}

@Injectable()
export class LeadsService {
  constructor(private prisma: PrismaService) {}

  async create(
    organizationId: string,
    dto: CreateLeadDto,
    requestingUser: { id: string; role: string; teamId: string | null },
  ) {
    const phoneClean = dto.phone.replace(/\D/g, '')

    const existing = await this.prisma.lead.findFirst({
      where: {
        organizationId,
        active: true,
        OR: [
          { phone: dto.phone },
          { phone: phoneClean },
          { phone2: dto.phone },
          { phone2: phoneClean },
        ],
      },
      select: { id: true, name: true, phone: true, status: true },
    })

    if (existing) {
      throw new ConflictException(
        `Já existe um lead cadastrado com esse telefone: ${existing.name} (${existing.status})`,
      )
    }

    const ownerId = dto.ownerId ?? requestingUser.id
    const teamId = dto.teamId ?? requestingUser.teamId ?? undefined

    const lead = await this.prisma.lead.create({
      data: { ...dto, organizationId, ownerId, teamId },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        funnelStage: true,
        tags: { include: { tag: true } },
      },
    })

    if (lead.funnelStage) {
      await this.prisma.leadStageHistory.create({
        data: {
          organizationId,
          leadId: lead.id,
          toStageId: lead.funnelStage.id,
          toStageName: normalizeStageName(lead.funnelStage.name),
          changedBy: requestingUser.id,
        },
      })
    }

    return lead
  }

  async findAll(
    organizationId: string,
    query: QueryLeadDto,
    requestingUser: { role: string; id: string; teamId: string | null },
  ) {
    const { search, status, source, funnelStageId, ownerId, teamId, urgency, page = 1, limit = 20 } = query

    const where: Record<string, unknown> = { organizationId, active: true }

    // Visibilidade por role
    if (requestingUser.role === 'corretor') {
      where.ownerId = requestingUser.id
    } else if (requestingUser.role === 'coordenador' && requestingUser.teamId) {
      where.teamId = requestingUser.teamId
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (status) where.status = status
    if (source) where.source = source
    if (funnelStageId) where.funnelStageId = funnelStageId
    if (ownerId) where.ownerId = ownerId
    if (teamId) where.teamId = teamId
    if (urgency) where.urgency = urgency

    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: { select: { id: true, name: true, avatarUrl: true } },
          funnelStage: true,
          tags: { include: { tag: true } },
          _count: { select: { tasks: true, interactions: true } },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.lead.count({ where }),
    ])

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  assertCanView(
    lead: { ownerId: string | null; teamId: string | null },
    requestingUser: { role: string; id: string; teamId: string | null },
  ) {
    if (requestingUser.role === 'corretor' && lead.ownerId !== requestingUser.id) {
      throw new ForbiddenException('Acesso negado')
    }
    if (requestingUser.role === 'coordenador' && lead.teamId !== requestingUser.teamId) {
      throw new ForbiddenException('Acesso negado')
    }
  }

  async findById(organizationId: string, id: string, requestingUser: { role: string; id: string; teamId: string | null }) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, active: true },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true, role: true } },
        team: { select: { id: true, name: true } },
        funnelStage: true,
        tags: { include: { tag: true } },
        interactions: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { occurredAt: 'desc' },
        },
        tasks: {
          where: { status: 'pendente' },
          include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { dueDate: 'asc' },
        },
        properties: {
          include: { property: true },
        },
        _count: { select: { interactions: true, tasks: true, documents: true } },
      },
    })

    if (!lead) throw new NotFoundException('Lead não encontrado')

    this.assertCanView(lead, requestingUser)

    // Buscar sugestões de imóveis por renda
    const incomeSuggestions = lead.income
      ? await this.prisma.property.findMany({
          where: {
            organizationId,
            active: true,
            sold: false,
            minIncome: { lte: lead.income },
            maxIncome: { gte: lead.income },
          },
          take: 5,
        })
      : []

    return { ...lead, incomeSuggestions }
  }

  async update(organizationId: string, id: string, dto: Partial<CreateLeadDto>) {
    await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.lead.update({
      where: { id },
      data: dto,
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        funnelStage: true,
        tags: { include: { tag: true } },
      },
    })
  }

  async getActiveSale(organizationId: string, id: string) {
    await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.sale.findFirst({
      where: { organizationId, leadId: id, status: { not: 'cancelado' } },
      select: { id: true, saleValue: true, status: true, soldAt: true, brokerId: true },
    })
  }

  async updateStage(organizationId: string, id: string, funnelStageId: string, changedBy: string) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    const stage = await this.prisma.funnelStage.findFirst({ where: { id: funnelStageId, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')

    const [updated] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: { funnelStageId, status: statusForStage(stage.name, lead.status), updatedAt: new Date() },
      }),
      this.prisma.leadStageHistory.create({
        data: {
          organizationId,
          leadId: id,
          fromStageId: lead.funnelStageId,
          toStageId: funnelStageId,
          toStageName: normalizeStageName(stage.name),
          changedBy,
        },
      }),
    ])

    return updated
  }

  async markAsLost(organizationId: string, id: string, lostReason: string, changedBy: string) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })

    const [updated] = await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id },
        data: { status: 'perdido', lostReason, funnelStageId: null },
      }),
      this.prisma.leadStageHistory.create({
        data: {
          organizationId,
          leadId: id,
          fromStageId: lead.funnelStageId,
          toStageName: 'perdido',
          changedBy,
        },
      }),
    ])

    return updated
  }

  async archive(organizationId: string, id: string) {
    await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.lead.update({ where: { id }, data: { active: false } })
  }

  async addTag(organizationId: string, leadId: string, tagId: string) {
    return this.prisma.leadTagRelation.create({ data: { leadId, tagId } })
  }

  async removeTag(organizationId: string, leadId: string, tagId: string) {
    return this.prisma.leadTagRelation.delete({ where: { leadId_tagId: { leadId, tagId } } })
  }

  async updateAiScore(organizationId: string, id: string, score: number, summary: string, nextSteps: string) {
    return this.prisma.lead.update({
      where: { id },
      data: { aiScore: score, aiSummary: summary, aiNextSteps: nextSteps, aiUpdatedAt: new Date() },
    })
  }
}
