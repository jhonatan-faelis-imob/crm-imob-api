import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../../prisma/prisma.service'
import type { EventStatus, Provider } from './providers'
import { sanitizePayload } from './sanitize'

const RETENTION_DAYS = 45
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const MAX_SUMMARY = 300

export interface RecordEventInput {
  organizationId: string
  provider: Provider
  kind: string
  status: EventStatus
  summary: string
  payload?: unknown
  leadId?: string | null
  /**
   * true (padrão): conta como atividade da integração (lastEventAt; erro grava lastError, ok/teste limpa).
   * false: registro de auditoria (ativação, chave consultada), não mexe no status
   */
  touch?: boolean
  /** Fica fora do corte de 8 KB: é por ele que a entrada de leads reconhece um reenvio */
  externalLeadId?: string | null
}

@Injectable()
export class IntegrationEventsService {
  private readonly logger = new Logger(IntegrationEventsService.name)
  // Limpeza de eventos antigos no máximo 1x por hora por organização (memória do processo)
  private readonly lastCleanup = new Map<string, number>()

  constructor(private prisma: PrismaService) {}

  async record(input: RecordEventInput) {
    const { organizationId, provider, kind, status, payload, leadId, externalLeadId, touch = true } = input
    const summary = input.summary.slice(0, MAX_SUMMARY)
    const now = new Date()

    const event = await this.prisma.integrationEvent.create({
      data: {
        organizationId,
        provider,
        kind,
        status,
        summary,
        leadId: leadId ?? null,
        ...(payload !== undefined && {
          payload: externalLeadId ? { externalLeadId, data: sanitizePayload(payload) } : sanitizePayload(payload),
        }),
      },
      select: { id: true },
    })

    if (touch) {
      await this.prisma.integration.updateMany({
        where: { organizationId, provider },
        data: {
          lastEventAt: now,
          ...(status === 'erro' && { lastError: summary }),
          ...((status === 'ok' || status === 'teste') && { lastError: null }),
        },
      })
    }

    await this.cleanup(organizationId, now)
    return event
  }

  async list(organizationId: string, provider: Provider, limit: number) {
    return this.prisma.integrationEvent.findMany({
      where: { organizationId, provider },
      // Sem o payload: só o resumo
      select: { id: true, kind: true, status: true, summary: true, leadId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  private async cleanup(organizationId: string, now: Date) {
    const last = this.lastCleanup.get(organizationId) ?? 0
    if (now.getTime() - last < CLEANUP_INTERVAL_MS) return
    this.lastCleanup.set(organizationId, now.getTime())
    try {
      await this.prisma.integrationEvent.deleteMany({
        where: { organizationId, createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } },
      })
    } catch (error) {
      this.logger.warn(`Falha ao apagar eventos antigos: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
