import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../../prisma/prisma.service'
import { IntegrationEventsService } from '../core/integration-events.service'
import { computeStatus, PROVIDER_CATALOG, type IntegrationStatus } from '../core/providers'
import { maskSecret, SecretsService } from '../core/secrets.service'
import { IntakeConfigDto } from '../dto/integrations.dto'
import { readIntakeConfig, type IntakeConfig } from '../intake/intake-config'
import { LeadIntakeService } from '../intake/lead-intake.service'
import { googleKeyOf, parseGoogleLead, safeEqual } from './google-ads.parser'

const PROVIDER = 'google_ads'
const INFO = PROVIDER_CATALOG.find((item) => item.provider === PROVIDER)!
const MAX_TOKEN_LENGTH = 64

export interface IntegrationUser {
  id: string
  name: string
  organizationId: string
}

/** O que as rotas autenticadas devolvem: nunca a chave completa, só a máscara */
export interface GoogleAdsView {
  provider: 'google_ads'
  enabled: boolean
  status: IntegrationStatus
  webhookUrl: string | null
  keyMasked: string | null
  publicUrlConfigured: boolean
  secretsError: string | null
  config: IntakeConfig
  lastEventAt: Date | null
  lastError: string | null
}

type IntegrationRow = Prisma.IntegrationGetPayload<object>

function toJson(config: IntakeConfig): Prisma.InputJsonObject {
  return {
    assignment: { userIds: config.assignment.userIds },
    createFirstContactTask: config.createFirstContactTask,
    firstContactMinutes: config.firstContactMinutes,
  }
}

function mergeConfig(current: IntakeConfig, dto: IntakeConfigDto): IntakeConfig {
  return {
    assignment: { userIds: dto.assignment?.userIds ?? current.assignment.userIds },
    createFirstContactTask: dto.createFirstContactTask ?? current.createFirstContactTask,
    firstContactMinutes: dto.firstContactMinutes ?? current.firstContactMinutes,
  }
}

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name)

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private secrets: SecretsService,
    private events: IntegrationEventsService,
    private intake: LeadIntakeService,
  ) {}

  // ---------- Rotas autenticadas (gerente ou superior) ----------

  async getView(organizationId: string): Promise<GoogleAdsView> {
    return this.toView(await this.find(organizationId))
  }

  async enable(user: IntegrationUser, dto: IntakeConfigDto) {
    const baseUrl = this.requirePublicUrl()
    const existing = await this.find(user.organizationId)
    const config = mergeConfig(readIntakeConfig(existing?.config), dto)
    await this.assertActiveUsers(user.organizationId, config.assignment.userIds)

    // Token e chave só nascem na primeira ativação: religar não muda o que está no Google Ads
    const stored = this.secrets.decryptJson(existing?.secretsEnc ?? null)
    const webhookKey = stored.webhookKey ?? randomBytes(24).toString('hex')
    const secretsEnc = stored.webhookKey && existing?.secretsEnc ? existing.secretsEnc : this.secrets.encryptJson({ ...stored, webhookKey })
    const publicToken = existing?.publicToken ?? randomBytes(24).toString('base64url')

    const row = await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId: user.organizationId, provider: PROVIDER } },
      create: {
        organizationId: user.organizationId,
        provider: PROVIDER,
        enabled: true,
        config: toJson(config),
        secretsEnc,
        publicToken,
        createdBy: user.id,
      },
      update: { enabled: true, config: toJson(config), secretsEnc, publicToken, createdBy: existing?.createdBy ?? user.id },
    })
    await this.audit(user, `Integração ativada por ${user.name}`)

    return { ...this.toView(row), webhookUrl: `${baseUrl}${this.webhookPath(publicToken)}`, keyMasked: maskSecret(webhookKey) }
  }

  async updateConfig(user: IntegrationUser, dto: IntakeConfigDto) {
    const existing = await this.findOrThrow(user.organizationId)
    const config = mergeConfig(readIntakeConfig(existing.config), dto)
    await this.assertActiveUsers(user.organizationId, config.assignment.userIds)
    const row = await this.prisma.integration.update({ where: { id: existing.id }, data: { config: toJson(config) } })
    return this.toView(row)
  }

  async disable(user: IntegrationUser) {
    const existing = await this.findOrThrow(user.organizationId)
    // Desligar mantém token, chave e configuração: religar volta a funcionar sem mexer no Google Ads
    const row = await this.prisma.integration.update({ where: { id: existing.id }, data: { enabled: false } })
    await this.audit(user, `Integração desativada por ${user.name}`)
    return this.toView(row)
  }

  /** Única rota que devolve a chave completa. Fica registrado quem consultou */
  async revealSecret(user: IntegrationUser) {
    const existing = await this.findOrThrow(user.organizationId)
    const webhookKey = this.secrets.decryptJson(existing.secretsEnc).webhookKey
    if (!webhookKey) throw new NotFoundException('A integração ainda não tem chave: ative primeiro')
    await this.audit(user, `Chave consultada por ${user.name}`)
    return { key: webhookKey }
  }

  async rotateKey(user: IntegrationUser) {
    const existing = await this.findOrThrow(user.organizationId)
    const stored = this.secrets.decryptJson(existing.secretsEnc)
    const webhookKey = randomBytes(24).toString('hex')
    const row = await this.prisma.integration.update({
      where: { id: existing.id },
      data: { secretsEnc: this.secrets.encryptJson({ ...stored, webhookKey }) },
    })
    await this.audit(user, `Nova chave gerada por ${user.name}; a anterior deixou de valer`)
    return {
      ...this.toView(row),
      keyMasked: maskSecret(webhookKey),
      message: 'Chave nova gerada. A anterior deixou de valer: atualize a chave no formulário do Google Ads.',
    }
  }

  // ---------- Webhook público ----------

  async receive(token: string, body: unknown): Promise<Record<string, never>> {
    const integration =
      token && token.length <= MAX_TOKEN_LENGTH
        ? await this.prisma.integration.findUnique({ where: { publicToken: token } })
        : null
    // Token desconhecido e integração desligada: a mesma resposta
    if (!integration || integration.provider !== PROVIDER || !integration.enabled) {
      throw new NotFoundException('Integração não encontrada')
    }
    const organizationId = integration.organizationId
    const base = { organizationId, provider: PROVIDER, payload: body } as const

    let storedKey: string | undefined
    try {
      storedKey = this.secrets.decryptJson(integration.secretsEnc).webhookKey
    } catch (error) {
      this.logger.error(`Google Ads: chave guardada ilegível (${error instanceof Error ? error.message : 'erro'})`)
    }
    if (!storedKey) {
      await this.events.record({ ...base, kind: 'webhook', status: 'erro', summary: 'Não foi possível ler a chave guardada' })
      throw new InternalServerErrorException('Integração sem chave válida')
    }

    const sentKey = googleKeyOf(body)
    if (!sentKey || !safeEqual(sentKey, storedKey)) {
      await this.events.record({ ...base, kind: 'webhook', status: 'erro', summary: 'Chave inválida' })
      throw new UnauthorizedException('Chave inválida')
    }

    const lead = parseGoogleLead(body)
    if (!lead) {
      await this.events.record({ ...base, kind: 'webhook', status: 'erro', summary: 'Corpo inválido: faltam lead_id ou user_column_data' })
      throw new BadRequestException('Corpo inválido: esperado JSON com lead_id e user_column_data')
    }

    if (lead.isTest) {
      await this.events.record({ ...base, kind: 'teste', status: 'teste', summary: 'Teste recebido' })
      return {}
    }

    try {
      await this.intake.ingest({
        organizationId,
        integrationId: integration.id,
        source: 'google_ads',
        sourceDetail: lead.sourceDetail,
        externalLeadId: lead.leadId,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        message: lead.answers.join('\n') || null,
        raw: body,
      })
    } catch (error) {
      this.logger.error(`Google Ads: falha ao receber lead (${error instanceof Error ? error.message : 'erro'})`)
      await this.events.record({ ...base, kind: 'lead', status: 'erro', summary: 'Erro inesperado ao receber o lead' })
      throw new InternalServerErrorException('Erro ao receber o lead')
    }
    return {}
  }

  // ---------- Apoio ----------

  private webhookPath(publicToken: string) {
    return `/api/v1/public/integrations/google-ads/${publicToken}`
  }

  private publicUrl() {
    const raw = this.config.get<string>('API_PUBLIC_URL')?.trim()
    return raw ? raw.replace(/\/+$/, '') : null
  }

  private requirePublicUrl() {
    const url = this.publicUrl()
    if (!url) {
      throw new BadRequestException(
        'API_PUBLIC_URL não configurada: informe o endereço público do backend (com https:// e sem barra no final)',
      )
    }
    return url
  }

  private find(organizationId: string) {
    return this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
    })
  }

  private async findOrThrow(organizationId: string) {
    const row = await this.find(organizationId)
    if (!row) throw new NotFoundException('Google Ads ainda não foi ativado')
    return row
  }

  private async assertActiveUsers(organizationId: string, userIds: string[]) {
    if (!userIds.length) return
    const found = await this.prisma.user.count({ where: { id: { in: userIds }, organizationId, active: true } })
    if (found !== new Set(userIds).size) {
      throw new BadRequestException('Escolha apenas usuários ativos da sua organização para receber os leads')
    }
  }

  private audit(user: IntegrationUser, summary: string) {
    return this.events.record({ organizationId: user.organizationId, provider: PROVIDER, kind: 'config', status: 'ok', summary, touch: false })
  }

  private toView(row: IntegrationRow | null): GoogleAdsView {
    const baseUrl = this.publicUrl()
    let keyMasked: string | null = null
    let secretsError: string | null = null
    if (row?.secretsEnc) {
      try {
        const key = this.secrets.decryptJson(row.secretsEnc).webhookKey
        keyMasked = key ? maskSecret(key) : null
      } catch (error) {
        secretsError = error instanceof Error ? error.message : 'Não foi possível ler a chave guardada'
      }
    }
    return {
      provider: PROVIDER,
      enabled: row?.enabled ?? false,
      status: computeStatus(INFO, row),
      webhookUrl: row?.publicToken && baseUrl ? `${baseUrl}${this.webhookPath(row.publicToken)}` : null,
      keyMasked,
      publicUrlConfigured: baseUrl !== null,
      secretsError,
      config: readIntakeConfig(row?.config),
      lastEventAt: row?.lastEventAt ?? null,
      lastError: row?.lastError ?? null,
    }
  }
}
