import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { findLeadByPhone, formatPhone, normalizePhone } from '../../../common/utils/phone'
import { normalizeStageName } from '../../../common/utils/stage'
import { PrismaService } from '../../../prisma/prisma.service'
import { CadencesService } from '../../cadences/cadences.service'
import { leadSourceLabel, type LeadSourceValue } from '../../leads/lead-sources'
import { IntegrationEventsService } from '../core/integration-events.service'
import { isProvider, type Provider } from '../core/providers'
import { readIntakeConfig } from './intake-config'

// Entrada de leads vindos de integrações (Google Ads; depois portais e Meta). Regras:
// - mesmo externalLeadId não cria nada de novo (idempotente)
// - lead já cadastrado pelo telefone: interação + tarefa de resposta, sem mexer no lastContactAt
//   (quem fez contato foi o cliente, não o corretor)
// - lead novo: primeira etapa do funil, histórico e cadência como no cadastro manual

const STAGE_TRANSACTION = { timeout: 15_000 }
const EXISTING_CONTACT_MINUTES = 15
const MESSAGE_PREVIEW = 200
const DAY_MS = 86_400_000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface IngestInput {
  organizationId: string
  integrationId: string
  source: LeadSourceValue
  sourceDetail: string | null
  externalLeadId: string | null
  name: string
  phone: string | null
  email: string | null
  /** Mensagem e respostas do formulário, já em texto ("Pergunta: resposta" por linha) */
  message: string | null
  raw: unknown
}

export type IngestResult =
  | { result: 'created'; leadId: string }
  | { result: 'duplicate'; leadId: string | null }
  | { result: 'existing_contact'; leadId: string }
  | { result: 'ignored' }

type IntakeIntegration = { id: string; provider: Provider; createdBy: string | null; config: Prisma.JsonValue }

function preview(message: string | null) {
  const text = (message ?? '').replace(/\s*\n\s*/g, ' · ').trim()
  return text.length > MESSAGE_PREVIEW ? `${text.slice(0, MESSAGE_PREVIEW - 1)}…` : text
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000)
}

@Injectable()
export class LeadIntakeService {
  constructor(
    private prisma: PrismaService,
    private cadences: CadencesService,
    private events: IntegrationEventsService,
  ) {}

  async ingest(input: IngestInput): Promise<IngestResult> {
    const integration = await this.loadIntegration(input.organizationId, input.integrationId)
    const { organizationId, externalLeadId } = input
    const provider = integration.provider
    const sourceLabel = leadSourceLabel(input.source)
    const base = { organizationId, provider, payload: input.raw, externalLeadId }

    if (externalLeadId && (await this.alreadyReceived(organizationId, provider, externalLeadId))) {
      const leadId = await this.leadIdByExternal(organizationId, externalLeadId)
      await this.events.record({ ...base, kind: 'lead', status: 'ignorado', summary: 'Lead já recebido', leadId })
      return { result: 'duplicate', leadId }
    }

    const phoneDigits = normalizePhone(input.phone)
    const email = input.email?.trim().toLowerCase() || null
    const validEmail = email && EMAIL.test(email) ? email : null
    if (!phoneDigits && !validEmail) {
      await this.events.record({ ...base, kind: 'lead', status: 'ignorado', summary: 'Sem contato válido (telefone ou e-mail)' })
      return { result: 'ignored' }
    }

    const name = input.name.trim() || validEmail || 'Lead sem nome'
    const existing = phoneDigits ? await findLeadByPhone(this.prisma, organizationId, phoneDigits) : null
    if (existing) {
      await this.registerExistingContact(integration, organizationId, existing, sourceLabel, input.message)
      await this.events.record({
        ...base,
        kind: 'contato_existente',
        status: 'ok',
        summary: `Novo contato de ${existing.name}, que já estava cadastrado`,
        leadId: existing.id,
      })
      return { result: 'existing_contact', leadId: existing.id }
    }

    try {
      const leadId = await this.createLead(integration, input, {
        name,
        phone: phoneDigits ? formatPhone(phoneDigits) : '',
        email: validEmail,
        sourceLabel,
      })
      await this.events.record({ ...base, kind: 'lead', status: 'ok', summary: `Lead criado: ${name}`, leadId })
      return { result: 'created', leadId }
    } catch (error) {
      // Duas entregas simultâneas do mesmo lead: a segunda bate no índice único
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && externalLeadId) {
        const leadId = await this.leadIdByExternal(organizationId, externalLeadId)
        await this.events.record({ ...base, kind: 'lead', status: 'ignorado', summary: 'Lead já recebido', leadId })
        return { result: 'duplicate', leadId }
      }
      throw error
    }
  }

  /**
   * Quem recebeu menos leads de integração nas últimas 24 horas; empate vai para quem recebeu há mais
   * tempo (ou nunca). Sem lista válida: o createdBy da integração, depois um gestor ativo
   */
  async pickAssignee(organizationId: string, userIds: string[], fallbackUserId: string | null): Promise<string | null> {
    const active = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, organizationId, active: true },
          select: { id: true },
        })
      : []
    const activeIds = new Set(active.map((user) => user.id))
    const candidates = userIds.filter((id, index) => activeIds.has(id) && userIds.indexOf(id) === index)

    if (!candidates.length) return this.fallbackAssignee(organizationId, fallbackUserId)
    if (candidates.length === 1) return candidates[0]

    const since = new Date(Date.now() - DAY_MS)
    const [recent, ever] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { organizationId, ownerId: { in: candidates }, externalLeadId: { not: null }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { organizationId, ownerId: { in: candidates }, externalLeadId: { not: null } },
        _max: { createdAt: true },
      }),
    ])
    const countBy = new Map(recent.map((row) => [row.ownerId, row._count._all]))
    const lastBy = new Map(ever.map((row) => [row.ownerId, row._max.createdAt?.getTime() ?? 0]))

    return [...candidates].sort((a, b) => {
      const byCount = (countBy.get(a) ?? 0) - (countBy.get(b) ?? 0)
      if (byCount !== 0) return byCount
      return (lastBy.get(a) ?? 0) - (lastBy.get(b) ?? 0)
    })[0]
  }

  private async fallbackAssignee(organizationId: string, preferred: string | null) {
    if (preferred) {
      const user = await this.prisma.user.findFirst({
        where: { id: preferred, organizationId, active: true },
        select: { id: true },
      })
      if (user) return user.id
    }
    const manager = await this.prisma.user.findFirst({
      where: { organizationId, active: true, role: { in: ['diretor', 'gerente'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    return manager?.id ?? null
  }

  private async loadIntegration(organizationId: string, integrationId: string): Promise<IntakeIntegration> {
    const row = await this.prisma.integration.findFirst({
      where: { id: integrationId, organizationId },
      select: { id: true, provider: true, createdBy: true, config: true },
    })
    if (!row || !isProvider(row.provider)) throw new NotFoundException('Integração não encontrada')
    return { ...row, provider: row.provider }
  }

  private async alreadyReceived(organizationId: string, provider: Provider, externalLeadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { organizationId, externalLeadId }, select: { id: true } })
    if (lead) return true
    // Contato de lead já cadastrado não grava o externalLeadId no lead: o reenvio é reconhecido pelo evento
    const event = await this.prisma.integrationEvent.findFirst({
      where: {
        organizationId,
        provider,
        kind: 'contato_existente',
        status: 'ok',
        payload: { path: ['externalLeadId'], equals: externalLeadId },
      },
      select: { id: true },
    })
    return !!event
  }

  private async leadIdByExternal(organizationId: string, externalLeadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { organizationId, externalLeadId }, select: { id: true } })
    return lead?.id ?? null
  }

  private async registerExistingContact(
    integration: IntakeIntegration,
    organizationId: string,
    lead: { id: string; name: string; ownerId: string | null },
    sourceLabel: string,
    message: string | null,
  ) {
    const summary = preview(message)
    // Sem lastContactAt: o contato partiu do cliente
    await this.prisma.interaction.create({
      data: {
        organizationId,
        leadId: lead.id,
        userId: null,
        type: 'outro',
        notes: `Novo contato recebido via ${sourceLabel}${summary ? `: ${summary}` : ''}`,
      },
    })

    const assignee = lead.ownerId ?? (await this.fallbackAssignee(organizationId, integration.createdBy))
    if (!assignee) return
    await this.prisma.task.create({
      data: {
        organizationId,
        leadId: lead.id,
        assignedTo: assignee,
        createdBy: integration.createdBy ?? assignee,
        title: `Responder novo contato de ${lead.name} (${sourceLabel})`,
        type: 'ligacao',
        priority: 'alta',
        dueDate: minutesFromNow(EXISTING_CONTACT_MINUTES),
      },
    })
  }

  private async createLead(
    integration: IntakeIntegration,
    input: IngestInput,
    contact: { name: string; phone: string; email: string | null; sourceLabel: string },
  ) {
    const { organizationId } = input
    const config = readIntakeConfig(integration.config)
    const ownerId = await this.pickAssignee(organizationId, config.assignment.userIds, integration.createdBy)
    const owner = ownerId
      ? await this.prisma.user.findFirst({ where: { id: ownerId, organizationId }, select: { teamId: true } })
      : null
    const stage = await this.prisma.funnelStage.findFirst({
      where: { organizationId },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, name: true },
    })
    const actorId = integration.createdBy ?? ownerId
    if (stage) await this.cadences.ensureDefaults(organizationId)

    const notes = [`Recebido via ${contact.sourceLabel}.`, input.message?.trim()].filter(Boolean).join('\n\n')

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          organizationId,
          ownerId,
          teamId: owner?.teamId ?? null,
          funnelStageId: stage?.id ?? null,
          status: 'novo',
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          source: input.source,
          sourceDetail: input.sourceDetail,
          externalLeadId: input.externalLeadId,
          intent: 'compra',
          notes,
        },
        select: { id: true, name: true, ownerId: true },
      })

      if (stage) {
        await tx.leadStageHistory.create({
          data: {
            organizationId,
            leadId: lead.id,
            toStageId: stage.id,
            toStageName: normalizeStageName(stage.name),
            changedBy: actorId,
          },
        })
      }
      // Cadência e tarefas precisam de um usuário (FK): sem nenhum gestor ativo, o lead entra sem elas
      if (stage && actorId) {
        await this.cadences.applyOnStageChange(tx, {
          organizationId,
          lead,
          fromStageId: null,
          toStageId: stage.id,
          actorId,
        })
      }

      if (config.createFirstContactTask && ownerId) {
        await tx.task.create({
          data: {
            organizationId,
            leadId: lead.id,
            assignedTo: ownerId,
            createdBy: actorId ?? ownerId,
            title: `Primeiro contato: ${contact.name} (${contact.sourceLabel})`,
            type: 'ligacao',
            priority: 'alta',
            dueDate: minutesFromNow(config.firstContactMinutes),
          },
        })
      }

      return lead.id
    }, STAGE_TRANSACTION)
  }
}
