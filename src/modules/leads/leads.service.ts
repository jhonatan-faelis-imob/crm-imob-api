import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { assertCanViewLead } from '../../common/utils/lead-visibility'
import {
  findLeadByPhone,
  normalizePhone,
  phoneCandidateWhere,
  phoneContainsDigits,
  phoneSearchDigits,
} from '../../common/utils/phone'
import { normalizeStageName } from '../../common/utils/stage'
import { PrismaService } from '../../prisma/prisma.service'
import { CadencesService, type CadenceResult } from '../cadences/cadences.service'
import { docsByLead, type LeadDocsSummary } from '../documents/checklist-rules'
import { CreateLeadDto } from './dto/create-lead.dto'
import { QueryLeadDto } from './dto/query-lead.dto'

const TERMINAL_STATUSES = ['ganho', 'perdido']
const NO_CADENCE: CadenceResult = { created: [], cancelled: 0 }
// Busca por telefone com poucos dígitos pode casar muita gente: confere no máximo esta quantidade de candidatos
const PHONE_SEARCH_CANDIDATES = 500

// Lead, histórico e cadência numa transação só; folga para a latência do banco remoto
const STAGE_TRANSACTION = { timeout: 15_000 }

const LEAD_INCLUDE = {
  owner: { select: { id: true, name: true, avatarUrl: true } },
  funnelStage: true,
  tags: { include: { tag: true } },
} satisfies Prisma.LeadInclude

type StageLead = { id: string; name: string; ownerId: string | null; status: string; funnelStageId: string | null }

export type LeadAccessUser = { organizationId: string; id: string; role: string; teamId: string | null }

function statusForStage(stageName: string, currentStatus: string) {
  const name = normalizeStageName(stageName)
  if (TERMINAL_STATUSES.includes(name)) return name
  return TERMINAL_STATUSES.includes(currentStatus) ? 'novo' : currentStatus
}

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private cadences: CadencesService,
  ) {}

  async create(
    organizationId: string,
    dto: CreateLeadDto,
    requestingUser: { id: string; role: string; teamId: string | null },
  ) {
    const existing = await this.findDuplicatePhone(organizationId, dto.phone)

    if (existing) {
      throw new ConflictException(
        `Já existe um lead cadastrado com esse telefone: ${existing.name} (${existing.status})`,
      )
    }

    const ownerId = dto.ownerId ?? requestingUser.id
    const teamId = dto.teamId ?? requestingUser.teamId ?? undefined

    // Sem etapa no corpo: a primeira do funil. Organização sem etapas: lead sem etapa e sem cadência
    const stage = dto.funnelStageId
      ? await this.findStage(organizationId, dto.funnelStageId)
      : await this.firstStage(organizationId)
    if (stage) await this.cadences.ensureDefaults(organizationId)

    // Devolve o lead como antes, mais `cadence` (acréscimo, igual ao PATCH /leads/:id/stage)
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: { ...dto, organizationId, ownerId, teamId, funnelStageId: stage?.id ?? null },
        include: LEAD_INCLUDE,
      })
      if (!stage) return { ...lead, cadence: NO_CADENCE }

      await tx.leadStageHistory.create({
        data: {
          organizationId,
          leadId: lead.id,
          toStageId: stage.id,
          toStageName: normalizeStageName(stage.name),
          changedBy: requestingUser.id,
        },
      })
      // Lead novo: nada a cancelar. Tarefas vão para o ownerId do lead (ou quem criou, se não houver)
      const cadence = await this.cadences.applyOnStageChange(tx, {
        organizationId,
        lead,
        fromStageId: null,
        toStageId: stage.id,
        actorId: requestingUser.id,
      })
      return { ...lead, cadence }
    }, STAGE_TRANSACTION)
  }

  private firstStage(organizationId: string) {
    return this.prisma.funnelStage.findFirst({
      where: { organizationId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, name: true },
    })
  }

  // Telefone válido: compara só os dígitos (acha número salvo com ou sem máscara, em phone ou phone2).
  // Fora do padrão brasileiro: mantém a comparação exata de antes
  private async findDuplicatePhone(organizationId: string, phone: string) {
    if (normalizePhone(phone)) return findLeadByPhone(this.prisma, organizationId, phone)
    const phoneClean = phone.replace(/D/g, '')
    return this.prisma.lead.findFirst({
      where: {
        organizationId,
        active: true,
        OR: [{ phone }, { phone: phoneClean }, { phone2: phone }, { phone2: phoneClean }],
      },
      select: { id: true, name: true, status: true },
    })
  }

  async findAll(
    organizationId: string,
    query: QueryLeadDto,
    requestingUser: { role: string; id: string; teamId: string | null },
  ) {
    const { search, status, source, funnelStageId, ownerId, teamId, urgency, page = 1, limit = 20 } = query

    // Cada regra entra no AND: um filtro nunca sobrescreve a visibilidade nem a busca
    const and: Prisma.LeadWhereInput[] = []

    // Visibilidade por role
    if (requestingUser.role === 'corretor') {
      and.push({ ownerId: requestingUser.id })
    } else if (requestingUser.role === 'coordenador' && requestingUser.teamId) {
      and.push({ teamId: requestingUser.teamId })
    }

    if (status) and.push({ status })
    if (source) and.push({ source })
    if (funnelStageId) and.push({ funnelStageId })
    if (ownerId) and.push({ ownerId })
    if (teamId) and.push({ teamId })
    if (urgency) and.push({ urgency })

    const base: Prisma.LeadWhereInput = { organizationId, active: true, AND: [...and] }
    const term = search?.trim()
    if (term) and.push(await this.searchWhere(base, term))

    const where: Prisma.LeadWhereInput = { organizationId, active: true, AND: and }
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

    const docs = await this.docsSummary(organizationId, data.map((lead) => lead.id))

    return {
      // docs é acréscimo: null quando o lead ainda não tem checklist
      data: data.map((lead) => ({ ...lead, docs: docs.get(lead.id) ?? null })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  /**
   * Nome ou e-mail (contains, sem diferenciar maiúsculas) ou telefone ignorando a máscara. O telefone só entra com 4+
   * dígitos: candidatos pelos últimos 8 dígitos dentro dos mesmos filtros, conferidos em memória (como a duplicidade)
   */
  private async searchWhere(base: Prisma.LeadWhereInput, term: string): Promise<Prisma.LeadWhereInput> {
    const or: Prisma.LeadWhereInput[] = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
    ]
    const digits = phoneSearchDigits(term)
    if (digits) {
      const candidates = await this.prisma.lead.findMany({
        where: { AND: [base, phoneCandidateWhere(digits)] },
        select: { id: true, phone: true, phone2: true },
        take: PHONE_SEARCH_CANDIDATES,
      })
      const ids = candidates
        .filter((lead) => phoneContainsDigits(lead.phone, digits) || phoneContainsDigits(lead.phone2, digits))
        .map((lead) => lead.id)
      if (ids.length) or.push({ id: { in: ids } })
    }
    return { OR: or }
  }

  // Uma consulta para a página inteira, agrupando por lead, status e obrigatoriedade
  private async docsSummary(organizationId: string, leadIds: string[]) {
    if (!leadIds.length) return new Map<string, LeadDocsSummary>()
    const groups = await this.prisma.leadChecklistItem.groupBy({
      by: ['leadId', 'status', 'required'],
      where: { organizationId, leadId: { in: leadIds } },
      _count: { _all: true },
    })
    return docsByLead(groups)
  }

  // Carrega o lead da organização do usuário e aplica a mesma regra de visibilidade do detalhe
  async assertLeadAccess(user: LeadAccessUser, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId: user.organizationId, active: true },
      select: {
        id: true,
        name: true,
        ownerId: true,
        teamId: true,
        spouseName: true,
        maritalStatus: true,
        fgtsValue: true,
      },
    })
    if (!lead) throw new NotFoundException('Lead não encontrado')
    this.assertCanView(lead, user)
    return lead
  }

  assertCanView(
    lead: { ownerId: string | null; teamId: string | null },
    requestingUser: { role: string; id: string; teamId: string | null },
  ) {
    assertCanViewLead(lead, requestingUser)
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

    const docs = await this.docsSummary(organizationId, [lead.id])

    return { ...lead, incomeSuggestions, docs: docs.get(lead.id) ?? null }
  }

  async update(organizationId: string, id: string, dto: Partial<CreateLeadDto>, changedBy: string) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    const { funnelStageId, ...rest } = dto

    if (!funnelStageId || funnelStageId === lead.funnelStageId) {
      return this.prisma.lead.update({ where: { id }, data: dto, include: LEAD_INCLUDE })
    }

    // Trocar a etapa por aqui segue o mesmo caminho de PATCH /leads/:id/stage
    const stage = await this.findStage(organizationId, funnelStageId)
    await this.cadences.ensureDefaults(organizationId)

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.lead.update({ where: { id }, data: rest })
      await this.moveToStage(tx, organizationId, current, stage, changedBy)
      return tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE })
    }, STAGE_TRANSACTION)
  }

  async getActiveSale(organizationId: string, id: string) {
    await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.sale.findFirst({
      where: { organizationId, leadId: id, status: { not: 'cancelado' } },
      select: { id: true, saleValue: true, status: true, soldAt: true, brokerId: true },
    })
  }

  // Devolve o lead como antes, mais `cadence` (acréscimo: o formato antigo continua valendo)
  async updateStage(organizationId: string, id: string, funnelStageId: string, changedBy: string) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })
    const stage = await this.findStage(organizationId, funnelStageId)
    await this.cadences.ensureDefaults(organizationId)

    const { updated, cadence } = await this.prisma.$transaction(
      (tx) => this.moveToStage(tx, organizationId, lead, stage, changedBy),
      STAGE_TRANSACTION,
    )

    return { ...updated, cadence }
  }

  async markAsLost(organizationId: string, id: string, lostReason: string, changedBy: string) {
    const lead = await this.prisma.lead.findFirstOrThrow({ where: { id, organizationId } })

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { status: 'perdido', lostReason, funnelStageId: null },
      })
      await tx.leadStageHistory.create({
        data: {
          organizationId,
          leadId: id,
          fromStageId: lead.funnelStageId,
          toStageName: 'perdido',
          changedBy,
        },
      })
      // Sem etapa de destino: só cancela as automáticas pendentes, não cria nenhuma
      await this.cadences.applyOnStageChange(tx, {
        organizationId,
        lead,
        fromStageId: lead.funnelStageId,
        toStageId: null,
        actorId: changedBy,
      })
      return updated
    }, STAGE_TRANSACTION)
  }

  private async findStage(organizationId: string, funnelStageId: string) {
    const stage = await this.prisma.funnelStage.findFirst({ where: { id: funnelStageId, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')
    return stage
  }

  private async moveToStage(
    tx: Prisma.TransactionClient,
    organizationId: string,
    lead: StageLead,
    stage: { id: string; name: string },
    changedBy: string,
  ) {
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { funnelStageId: stage.id, status: statusForStage(stage.name, lead.status), updatedAt: new Date() },
    })
    await tx.leadStageHistory.create({
      data: {
        organizationId,
        leadId: lead.id,
        fromStageId: lead.funnelStageId,
        toStageId: stage.id,
        toStageName: normalizeStageName(stage.name),
        changedBy,
      },
    })
    const cadence: CadenceResult = await this.cadences.applyOnStageChange(tx, {
      organizationId,
      lead: updated,
      fromStageId: lead.funnelStageId,
      toStageId: stage.id,
      actorId: changedBy,
    })
    return { updated, cadence }
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
