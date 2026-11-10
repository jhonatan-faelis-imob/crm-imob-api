import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { IntegrationEventsService } from './core/integration-events.service'
import {
  computeStatus,
  isProvider,
  PROVIDER_CATALOG,
  type IntegrationStatus,
  type Provider,
  type ProviderGroup,
} from './core/providers'

export interface CatalogItem {
  provider: Provider
  group: ProviderGroup
  name: string
  description: string
  status: IntegrationStatus
  enabled: boolean
  lastEventAt: Date | null
  lastError: string | null
  requirements: string[]
}

@Injectable()
export class IntegrationsService {
  constructor(
    private prisma: PrismaService,
    private events: IntegrationEventsService,
  ) {}

  async catalog(organizationId: string): Promise<CatalogItem[]> {
    // select explícito: secretsEnc e publicToken nunca saem daqui
    const rows = await this.prisma.integration.findMany({
      where: { organizationId },
      select: { provider: true, enabled: true, lastEventAt: true, lastError: true },
    })
    const byProvider = new Map(rows.map((row) => [row.provider, row]))

    return PROVIDER_CATALOG.map((info) => {
      const row = byProvider.get(info.provider) ?? null
      // IA sem registro: ligada com a chave do sistema (comportamento de antes)
      const enabledByDefault = info.provider === 'ai'
      const status = computeStatus(info, row, enabledByDefault)
      return {
        provider: info.provider,
        group: info.group,
        name: info.name,
        description: info.description,
        status,
        enabled: !info.comingSoon && (row ? row.enabled : enabledByDefault),
        lastEventAt: row?.lastEventAt ?? null,
        lastError: row?.lastError ?? null,
        requirements: info.requirements,
      }
    })
  }

  async listEvents(organizationId: string, provider: string, limit = 50) {
    if (!isProvider(provider)) throw new NotFoundException('Integração não encontrada')
    return this.events.list(organizationId, provider, Math.min(Math.max(limit, 1), 100))
  }
}
