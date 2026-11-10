import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { IntegrationEventsService } from '../integrations/core/integration-events.service'
import { computeStatus, PROVIDER_CATALOG, type IntegrationStatus } from '../integrations/core/providers'
import { maskSecret, SecretsService } from '../integrations/core/secrets.service'
import type { UpdateAiSettingsDto } from '../integrations/dto/integrations.dto'

// Configuração de IA por organização (Integration com provider = 'ai').
// Sem registro: tudo ligado com a chave do sistema, como era antes

const PROVIDER = 'ai'
const INFO = PROVIDER_CATALOG.find((item) => item.provider === PROVIDER)!
/** Padrão de antes; em produção, definir GEMINI_MODEL */
export const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash'
export const AI_DISABLED_MESSAGE = 'Recurso de IA desativado pelo gestor'
const MAX_ERROR_TEXT = 300

export type AiFeature = 'leadScore' | 'propertyCopy'

export interface AiConfig {
  enabled: boolean
  useOwnKey: boolean
  features: Record<AiFeature, boolean>
}

export interface AiSettingsView extends AiConfig {
  provider: 'ai'
  status: IntegrationStatus
  hasOwnKey: boolean
  keyMasked: string | null
  systemKeyConfigured: boolean
  model: string
  secretsError: string | null
  lastEventAt: Date | null
  lastError: string | null
}

type AiUser = { id: string; name: string; organizationId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readAiConfig(config: Prisma.JsonValue | null | undefined): AiConfig {
  const raw = isRecord(config) ? config : {}
  const features = isRecord(raw.features) ? raw.features : {}
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  return {
    enabled: flag(raw.enabled, true),
    useOwnKey: flag(raw.useOwnKey, false),
    features: { leadScore: flag(features.leadScore, true), propertyCopy: flag(features.propertyCopy, true) },
  }
}

/** Texto de erro do provedor, sem a chave (nem nenhuma chave do Google) e resumido */
export function providerErrorText(error: unknown, apiKey: string) {
  let text = error instanceof Error ? error.message : String(error)
  if (apiKey) text = text.split(apiKey).join('••••')
  text = text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '••••').replace(/key=[^&\s]+/gi, 'key=••••').replace(/\s+/g, ' ').trim()
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT - 1)}…` : text
}

function toJson(config: AiConfig): Prisma.InputJsonObject {
  return { enabled: config.enabled, useOwnKey: config.useOwnKey, features: { ...config.features } }
}

@Injectable()
export class AiSettingsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private secrets: SecretsService,
    private events: IntegrationEventsService,
  ) {}

  model() {
    return this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL
  }

  private systemKey() {
    return this.config.get<string>('gemini.apiKey') ?? ''
  }

  private find(organizationId: string) {
    return this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: PROVIDER } },
    })
  }

  async getView(organizationId: string): Promise<AiSettingsView> {
    const row = await this.find(organizationId)
    const config = readAiConfig(row?.config)
    let keyMasked: string | null = null
    let secretsError: string | null = null
    if (row?.secretsEnc) {
      try {
        const key = this.secrets.decryptJson(row.secretsEnc).geminiKey
        keyMasked = key ? maskSecret(key) : null
      } catch (error) {
        secretsError = error instanceof Error ? error.message : 'Não foi possível ler a chave guardada'
      }
    }
    return {
      provider: PROVIDER,
      ...config,
      status: computeStatus(INFO, row ? { ...row, enabled: config.enabled } : null, true),
      hasOwnKey: !!row?.secretsEnc,
      keyMasked,
      systemKeyConfigured: !!this.systemKey(),
      model: this.model(),
      secretsError,
      lastEventAt: row?.lastEventAt ?? null,
      lastError: row?.lastError ?? null,
    }
  }

  async update(user: AiUser, dto: UpdateAiSettingsDto) {
    const row = await this.find(user.organizationId)
    const current = readAiConfig(row?.config)
    const next: AiConfig = {
      enabled: dto.enabled ?? current.enabled,
      useOwnKey: dto.useOwnKey ?? current.useOwnKey,
      features: {
        leadScore: dto.features?.leadScore ?? current.features.leadScore,
        propertyCopy: dto.features?.propertyCopy ?? current.features.propertyCopy,
      },
    }
    await this.save(user, { config: toJson(next), enabled: next.enabled })
    return this.getView(user.organizationId)
  }

  async saveKey(user: AiUser, apiKey: string) {
    const row = await this.find(user.organizationId)
    const stored = row?.secretsEnc ? this.secrets.decryptJson(row.secretsEnc) : {}
    const secretsEnc = this.secrets.encryptJson({ ...stored, geminiKey: apiKey.trim() })
    const config = { ...readAiConfig(row?.config), useOwnKey: true }
    await this.save(user, { secretsEnc, config: toJson(config), enabled: config.enabled })
    await this.audit(user, `Chave própria do Gemini salva por ${user.name}`)
    return this.getView(user.organizationId)
  }

  async removeKey(user: AiUser) {
    const row = await this.find(user.organizationId)
    if (!row) throw new NotFoundException('Nenhuma chave própria salva')
    const config = { ...readAiConfig(row.config), useOwnKey: false }
    await this.prisma.integration.update({ where: { id: row.id }, data: { secretsEnc: null, config: toJson(config) } })
    await this.audit(user, `Chave própria do Gemini removida por ${user.name}`)
    return this.getView(user.organizationId)
  }

  /** Chave e modelo que valem para a organização. Recurso desligado: 403 */
  async resolve(organizationId: string, feature?: AiFeature) {
    const row = await this.find(organizationId)
    const config = readAiConfig(row?.config)
    if (feature && (!config.enabled || !config.features[feature])) throw new ForbiddenException(AI_DISABLED_MESSAGE)

    let apiKey = this.systemKey()
    let ownKey = false
    if (config.useOwnKey && row?.secretsEnc) {
      const key = this.secrets.decryptJson(row.secretsEnc).geminiKey
      if (key) {
        apiKey = key
        ownKey = true
      }
    }
    return { apiKey, model: this.model(), ownKey }
  }

  /** Chamada mínima ao modelo com a chave que vale para a organização */
  async test(user: AiUser): Promise<{ ok: boolean; message: string }> {
    let resolved: { apiKey: string; model: string; ownKey: boolean }
    try {
      resolved = await this.resolve(user.organizationId)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Não foi possível ler a chave' }
    }
    const { apiKey, model, ownKey } = resolved
    const keyLabel = ownKey ? 'chave própria' : 'chave do sistema'
    if (!apiKey) return { ok: false, message: 'Nenhuma chave do Gemini configurada' }

    try {
      const result = await new GoogleGenerativeAI(apiKey)
        .getGenerativeModel({ model })
        .generateContent('Responda apenas OK')
      const answer = result.response.text().trim().slice(0, 40)
      const message = `Conexão OK com o modelo ${model} (${keyLabel}). Resposta: ${answer || '(vazia)'}`
      await this.events.record({ organizationId: user.organizationId, provider: PROVIDER, kind: 'teste_conexao', status: 'ok', summary: message })
      return { ok: true, message }
    } catch (error) {
      const message = `Falha com o modelo ${model} (${keyLabel}): ${providerErrorText(error, apiKey)}`
      await this.events.record({ organizationId: user.organizationId, provider: PROVIDER, kind: 'teste_conexao', status: 'erro', summary: message })
      return { ok: false, message }
    }
  }

  private async save(user: AiUser, data: { config: Prisma.InputJsonObject; enabled: boolean; secretsEnc?: string }) {
    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId: user.organizationId, provider: PROVIDER } },
      create: { organizationId: user.organizationId, provider: PROVIDER, createdBy: user.id, ...data },
      update: data,
    })
  }

  private audit(user: AiUser, summary: string) {
    return this.events.record({ organizationId: user.organizationId, provider: PROVIDER, kind: 'config', status: 'ok', summary, touch: false })
  }
}
