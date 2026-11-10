import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Reflector } from '@nestjs/core'
import { randomBytes } from 'crypto'
import { RolesGuard } from '../../common/guards/roles.guard'
import { findLeadByPhone, formatPhone, normalizePhone } from '../../common/utils/phone'
import { PrismaService } from '../../prisma/prisma.service'
import { AiSettingsService, providerErrorText } from '../ai/ai-settings.service'
import { CadencesService } from '../cadences/cadences.service'
import { IntegrationEventsService } from './core/integration-events.service'
import { computeStatus } from './core/providers'
import { sanitizePayload } from './core/sanitize'
import { SecretsService } from './core/secrets.service'
import { GoogleAdsService } from './google-ads/google-ads.service'
import { parseGoogleLead } from './google-ads/google-ads.parser'
import { LeadIntakeService } from './intake/lead-intake.service'
import { IntegrationsController } from './integrations.controller'
import { IntegrationsService } from './integrations.service'

const ORG = 'org-1'
const ENC_KEY = randomBytes(32).toString('base64')
const PUBLIC_URL = 'https://api.crmimob.com.br'

function fakeConfig(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService
}

// ---------------------------------------------------------------- banco em memória

type Row = Record<string, unknown>
type Where = Record<string, unknown>

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((part) => matches(row, part))
    const value = row[key]
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as Record<string, unknown>
      if ('in' in c) return (c.in as unknown[]).includes(value)
      if ('contains' in c) return typeof value === 'string' && value.includes(c.contains as string)
      if ('not' in c) return c.not === null ? value !== null && value !== undefined : value !== c.not
      if ('gte' in c) return value instanceof Date && value >= (c.gte as Date)
      if ('lt' in c) return value instanceof Date && value < (c.lt as Date)
      if ('path' in c) {
        const payload = value as Record<string, unknown> | null
        return !!payload && payload[(c.path as string[])[0]] === c.equals
      }
    }
    return value === condition
  })
}

function table(rows: Row[], prefix: string) {
  return {
    rows,
    findFirst: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)))),
    count: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)).length)),
    create: jest.fn(({ data }: { data: Row }) => {
      const row = { id: nextId(prefix), createdAt: new Date(), ...data }
      rows.push(row)
      return Promise.resolve(row)
    }),
    update: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const row = rows.find((item) => matches(item, where))
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      return Promise.resolve(row)
    }),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const found = rows.filter((row) => matches(row, where))
      found.forEach((row) => Object.assign(row, data))
      return Promise.resolve({ count: found.length })
    }),
    deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
  }
}

function fakeDb() {
  const integrations = table([], 'int')
  const integration = {
    ...integrations,
    findUnique: jest.fn(({ where }: { where: { publicToken?: string; organizationId_provider?: Where } }) => {
      const condition = where.publicToken ? { publicToken: where.publicToken } : where.organizationId_provider
      return Promise.resolve(integrations.rows.find((row) => matches(row, condition)) ?? null)
    }),
    upsert: jest.fn(({ where, create, update }: { where: { organizationId_provider: Where }; create: Row; update: Row }) => {
      const row = integrations.rows.find((item) => matches(item, where.organizationId_provider))
      if (row) return Promise.resolve(Object.assign(row, update))
      return integrations.create({ data: { lastEventAt: null, lastError: null, publicToken: null, secretsEnc: null, ...create } })
    }),
  }
  const leads = table([], 'lead')
  const lead = {
    ...leads,
    groupBy: jest.fn(({ where }: { where: Where }) => {
      const found = leads.rows.filter((row) => matches(row, where))
      const owners = [...new Set(found.map((row) => row.ownerId as string))]
      return Promise.resolve(
        owners.map((ownerId) => {
          const own = found.filter((row) => row.ownerId === ownerId)
          const max = own.reduce((acc, row) => Math.max(acc, (row.createdAt as Date).getTime()), 0)
          return { ownerId, _count: { _all: own.length }, _max: { createdAt: new Date(max) } }
        }),
      )
    }),
  }
  const tables = {
    integration,
    integrationEvent: table([], 'evt'),
    lead,
    user: table([], 'user'),
    funnelStage: table([], 'stage'),
    interaction: table([], 'inter'),
    task: table([], 'task'),
    leadStageHistory: table([], 'hist'),
  }
  return { ...tables, $transaction: jest.fn(<T>(fn: (tx: typeof tables) => Promise<T>) => fn(tables)) }
}

type Db = ReturnType<typeof fakeDb>

function setup(env: Record<string, string | undefined> = {}) {
  const db = fakeDb()
  const prisma = db as unknown as PrismaService
  const config = fakeConfig({ INTEGRATIONS_ENC_KEY: ENC_KEY, API_PUBLIC_URL: PUBLIC_URL, ...env })
  const secrets = new SecretsService(config)
  const events = new IntegrationEventsService(prisma)
  const cadences = {
    ensureDefaults: jest.fn(() => Promise.resolve()),
    applyOnStageChange: jest.fn(() => Promise.resolve({ created: [], cancelled: 0 })),
  }
  const intake = new LeadIntakeService(prisma, cadences as unknown as CadencesService, events)
  const googleAds = new GoogleAdsService(prisma, config, secrets, events, intake)
  const catalog = new IntegrationsService(prisma, events)
  const ai = new AiSettingsService(prisma, config, secrets, events)

  db.user.rows.push(
    { id: 'manager', organizationId: ORG, active: true, role: 'gerente', teamId: null, name: 'Gerente', createdAt: new Date(0) },
    { id: 'broker-a', organizationId: ORG, active: true, role: 'corretor', teamId: 'team-1', name: 'Ana', createdAt: new Date(1) },
    { id: 'broker-b', organizationId: ORG, active: true, role: 'corretor', teamId: 'team-1', name: 'Bruno', createdAt: new Date(2) },
  )
  db.funnelStage.rows.push(
    { id: 'stage-2', organizationId: ORG, name: 'Contato', orderIndex: 1 },
    { id: 'stage-1', organizationId: ORG, name: 'Novo', orderIndex: 0 },
  )
  // findFirst com orderBy orderIndex: devolve a de menor ordem
  db.funnelStage.findFirst.mockImplementation(() =>
    Promise.resolve([...db.funnelStage.rows].sort((a, b) => (a.orderIndex as number) - (b.orderIndex as number))[0]),
  )

  return { db, secrets, events, cadences, intake, googleAds, catalog, ai }
}

const manager = { id: 'manager', name: 'Gerente', organizationId: ORG }

async function enableGoogle(ctx: ReturnType<typeof setup>, dto = {}) {
  const enabled = await ctx.googleAds.enable(manager, dto)
  const token = enabled.webhookUrl.split('/').pop() ?? ''
  const { key } = await ctx.googleAds.revealSecret(manager)
  return { enabled, token, key }
}

function googleBody(key: string, overrides: Record<string, unknown> = {}) {
  return {
    lead_id: 'G-1',
    api_version: '1.0',
    form_id: 456,
    campaign_id: 123,
    google_key: key,
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Maria da Silva' },
      { column_id: 'PHONE_NUMBER', string_value: '+5519995461826' },
      { column_id: 'email', string_value: 'maria@exemplo.com' },
      { column_id: 'QUESTION_1', column_name: 'Quantos quartos?', string_value: '3' },
      { column_id: 'POSTAL_CODE', string_value: '13010-000' },
    ],
    ...overrides,
  }
}

function eventsOf(db: Db) {
  return db.integrationEvent.rows
}

// ---------------------------------------------------------------- cofre

describe('cofre de segredos', () => {
  it('criptografa e descriptografa no formato v1', () => {
    const secrets = new SecretsService(fakeConfig({ INTEGRATIONS_ENC_KEY: ENC_KEY }))
    const stored = secrets.encrypt('segredo-123')
    expect(stored.split(':')).toHaveLength(4)
    expect(stored.startsWith('v1:')).toBe(true)
    expect(stored).not.toContain('segredo-123')
    expect(secrets.decrypt(stored)).toBe('segredo-123')
    // IV aleatório: o mesmo texto não gera o mesmo resultado
    expect(secrets.encrypt('segredo-123')).not.toBe(stored)
  })

  it('falha com chave errada ou texto adulterado', () => {
    const stored = new SecretsService(fakeConfig({ INTEGRATIONS_ENC_KEY: ENC_KEY })).encrypt('segredo')
    const other = new SecretsService(fakeConfig({ INTEGRATIONS_ENC_KEY: randomBytes(32).toString('base64') }))
    expect(() => other.decrypt(stored)).toThrow(/não foi possível ler/i)
    const parts = stored.split(':')
    parts[3] = Buffer.from('outro texto').toString('base64')
    expect(() => new SecretsService(fakeConfig({ INTEGRATIONS_ENC_KEY: ENC_KEY })).decrypt(parts.join(':'))).toThrow()
    expect(() => other.decrypt('v2:a:b:c')).toThrow(/formato/)
  })

  it('sem a variável ou com tamanho errado, falha com mensagem clara só ao usar', () => {
    expect(() => new SecretsService(fakeConfig({})).encrypt('x')).toThrow('INTEGRATIONS_ENC_KEY não configurada')
    const short = new SecretsService(fakeConfig({ INTEGRATIONS_ENC_KEY: randomBytes(16).toString('base64') }))
    expect(() => short.encrypt('x')).toThrow(/32 bytes/)
  })
})

// ---------------------------------------------------------------- nenhuma resposta com segredo

describe('respostas da API sem segredo', () => {
  it('Google Ads, catálogo e IA só devolvem a máscara', async () => {
    const ctx = setup()
    const { key } = await enableGoogle(ctx, { assignment: { userIds: ['broker-a'] } })
    const ownKey = 'AIzaSyMinhaChavePropriaDoGemini1234'
    const integrationRow = ctx.db.integration.rows[0]

    const responses: unknown[] = [
      await ctx.googleAds.getView(ORG),
      await ctx.googleAds.updateConfig(manager, { firstContactMinutes: 30 }),
      await ctx.googleAds.disable(manager),
      await ctx.googleAds.enable(manager, {}),
      await ctx.catalog.catalog(ORG),
      await ctx.catalog.listEvents(ORG, 'google_ads'),
      await ctx.ai.saveKey(manager, ownKey),
      await ctx.ai.getView(ORG),
      await ctx.ai.update(manager, { useOwnKey: true }),
    ]
    const rotated = await ctx.googleAds.rotateKey(manager)
    const newKey = (await ctx.googleAds.revealSecret(manager)).key
    responses.push(rotated)

    for (const response of responses) {
      const json = JSON.stringify(response)
      for (const secret of [key, newKey, ownKey, integrationRow.secretsEnc as string]) expect(json).not.toContain(secret)
      expect(json).not.toContain('secretsEnc')
    }
    expect(JSON.stringify(rotated)).toContain(`••••${newKey.slice(-4)}`)
    // Eventos também não guardam as chaves
    expect(JSON.stringify(eventsOf(ctx.db))).not.toContain(key)
    expect(JSON.stringify(eventsOf(ctx.db))).not.toContain(ownKey)
  })

  it('sanitiza o payload: tira chaves e tokens e corta em 8 KB', () => {
    expect(sanitizePayload({ google_key: 'x', nested: { access_token: 'y', ok: 1 } })).toEqual({ nested: { ok: 1 } })
    const big = sanitizePayload({ text: 'a'.repeat(20_000) }) as { truncated: boolean; preview: string }
    expect(big.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThanOrEqual(8 * 1024)
  })

  it('erro do provedor de IA não mostra a chave', () => {
    const key = 'AIzaSyChaveSecretaQueNaoPodeAparecer99'
    const text = providerErrorText(new Error(`[400] API key not valid: ${key} (url ...?key=${key})`), key)
    expect(text).not.toContain(key)
    expect(text).toContain('API key not valid')
  })
})

// ---------------------------------------------------------------- telefone

describe('telefone', () => {
  it.each([
    ['+55 19 99546-1826', '19995461826'],
    ['(19) 99546-1826', '19995461826'],
    ['19995461826', '19995461826'],
    ['5519995461826', '19995461826'],
    ['(19) 3254-1826', '1932541826'],
  ])('normaliza %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected)
  })

  it('número curto ou vazio é inválido', () => {
    expect(normalizePhone('99546-1826')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it('formata celular e fixo', () => {
    expect(formatPhone('19995461826')).toBe('(19) 99546-1826')
    expect(formatPhone('1932541826')).toBe('(19) 3254-1826')
  })

  it('findLeadByPhone acha telefone salvo com máscara, a partir de só dígitos, e no phone2', async () => {
    const db = fakeDb()
    db.lead.rows.push(
      { id: 'l1', organizationId: ORG, active: true, name: 'Com máscara', status: 'novo', ownerId: 'u', phone: '(19) 99546-1826', phone2: null },
      { id: 'l2', organizationId: ORG, active: true, name: 'No phone2', status: 'novo', ownerId: 'u', phone: '(11) 90000-0000', phone2: '+55 21 3254-1826' },
      { id: 'l3', organizationId: 'outra', active: true, name: 'Outra org', status: 'novo', ownerId: 'u', phone: '19988887777', phone2: null },
    )
    const prisma = db as unknown as PrismaService
    expect((await findLeadByPhone(prisma, ORG, '19995461826'))?.id).toBe('l1')
    expect((await findLeadByPhone(prisma, ORG, '+5519995461826'))?.id).toBe('l1')
    expect((await findLeadByPhone(prisma, ORG, '2132541826'))?.id).toBe('l2')
    expect(await findLeadByPhone(prisma, ORG, '19988887777')).toBeNull()
    // Mesmos 8 últimos dígitos, DDD diferente: não é o mesmo número
    expect(await findLeadByPhone(prisma, ORG, '11995461826')).toBeNull()
  })
})

// ---------------------------------------------------------------- webhook do Google

describe('webhook do Google Ads', () => {
  it('confere os nomes de coluna e manda as outras para as observações', () => {
    const parsed = parseGoogleLead(googleBody('k'))!
    expect(parsed).toMatchObject({ leadId: 'G-1', name: 'Maria da Silva', phone: '+5519995461826', email: 'maria@exemplo.com' })
    expect(parsed.answers).toEqual(['Quantos quartos?: 3', 'Postal code: 13010-000'])
    expect(parsed.sourceDetail).toBe('Google Ads · campanha 123 · formulário 456')
    const split = parseGoogleLead({
      lead_id: 'x',
      user_column_data: [
        { column_id: 'FIRST_NAME', string_value: 'João' },
        { column_id: 'LAST_NAME', string_value: 'Souza' },
      ],
    })!
    expect(split.name).toBe('João Souza')
    expect(parseGoogleLead({ user_column_data: [] })).toBeNull()
    expect(parseGoogleLead({ lead_id: '1' })).toBeNull()
  })

  it('chave correta cria o lead na primeira etapa, com origem, responsável e tarefa de primeiro contato', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx, { assignment: { userIds: ['broker-a'] }, firstContactMinutes: 20 })

    await expect(ctx.googleAds.receive(token, googleBody(key))).resolves.toEqual({})

    expect(ctx.db.lead.rows).toHaveLength(1)
    const lead = ctx.db.lead.rows[0]
    expect(lead).toMatchObject({
      funnelStageId: 'stage-1',
      status: 'novo',
      source: 'google_ads',
      sourceDetail: 'Google Ads · campanha 123 · formulário 456',
      externalLeadId: 'G-1',
      ownerId: 'broker-a',
      teamId: 'team-1',
      phone: '(19) 99546-1826',
      email: 'maria@exemplo.com',
    })
    expect(lead.notes).toContain('Quantos quartos?: 3')
    expect(lead.notes).toContain('Postal code: 13010-000')
    expect(ctx.db.leadStageHistory.rows).toHaveLength(1)
    expect(ctx.cadences.applyOnStageChange).toHaveBeenCalledTimes(1)

    const task = ctx.db.task.rows[0]
    expect(task).toMatchObject({ title: 'Primeiro contato: Maria da Silva (Google Ads)', priority: 'alta', assignedTo: 'broker-a', createdBy: 'manager' })
    const minutes = ((task.dueDate as Date).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(19)
    expect(minutes).toBeLessThanOrEqual(20)

    const leadEvent = eventsOf(ctx.db).find((event) => event.kind === 'lead')!
    expect(leadEvent).toMatchObject({ status: 'ok', leadId: lead.id })
    expect(JSON.stringify(leadEvent.payload)).not.toContain(key)
    expect(JSON.stringify(leadEvent.payload)).not.toContain('google_key')
    expect(ctx.db.integration.rows[0].lastEventAt).toBeInstanceOf(Date)
  })

  it('chave errada responde 401 e grava evento de erro', async () => {
    const ctx = setup()
    const { token } = await enableGoogle(ctx)
    await expect(ctx.googleAds.receive(token, googleBody('chave-errada'))).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(ctx.googleAds.receive(token, { lead_id: '1' })).rejects.toBeInstanceOf(UnauthorizedException)
    expect(ctx.db.lead.rows).toHaveLength(0)
    expect(eventsOf(ctx.db).filter((event) => event.status === 'erro').map((event) => event.summary)).toEqual(['Chave inválida', 'Chave inválida'])
    expect(ctx.db.integration.rows[0].lastError).toBe('Chave inválida')
    expect(JSON.stringify(eventsOf(ctx.db))).not.toContain('chave-errada')
  })

  it('token desconhecido ou integração desligada respondem 404', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    await expect(ctx.googleAds.receive('nao-existe', googleBody(key))).rejects.toBeInstanceOf(NotFoundException)
    await ctx.googleAds.disable(manager)
    await expect(ctx.googleAds.receive(token, googleBody(key))).rejects.toBeInstanceOf(NotFoundException)
  })

  it('corpo sem lead_id ou user_column_data responde 400', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    await expect(ctx.googleAds.receive(token, { google_key: key })).rejects.toMatchObject({ status: 400 })
  })

  it('is_test responde 200 sem criar lead', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    await expect(ctx.googleAds.receive(token, googleBody(key, { is_test: true }))).resolves.toEqual({})
    expect(ctx.db.lead.rows).toHaveLength(0)
    expect(eventsOf(ctx.db).find((event) => event.status === 'teste')?.summary).toBe('Teste recebido')
  })

  it('o mesmo lead_id duas vezes não duplica', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    await ctx.googleAds.receive(token, googleBody(key))
    await expect(ctx.googleAds.receive(token, googleBody(key))).resolves.toEqual({})
    expect(ctx.db.lead.rows).toHaveLength(1)
    expect(ctx.db.task.rows).toHaveLength(1)
    expect(eventsOf(ctx.db).some((event) => event.status === 'ignorado' && event.summary === 'Lead já recebido')).toBe(true)
  })

  it('sem telefone válido e sem e-mail: 200, evento ignorado e nenhum lead', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    const body = googleBody(key, { user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Sem contato' }, { column_id: 'PHONE_NUMBER', string_value: '123' }] })
    await expect(ctx.googleAds.receive(token, body)).resolves.toEqual({})
    expect(ctx.db.lead.rows).toHaveLength(0)
    expect(eventsOf(ctx.db).some((event) => String(event.summary).startsWith('Sem contato válido'))).toBe(true)
  })
})

// ---------------------------------------------------------------- lead que já existe

describe('lead com telefone já cadastrado', () => {
  it('não cria outro: grava interação e tarefa de resposta, sem mudar o lastContactAt', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx, { assignment: { userIds: ['broker-a'] } })
    const lastContactAt = new Date('2026-01-01T12:00:00Z')
    ctx.db.lead.rows.push({
      id: 'old-lead', organizationId: ORG, active: true, name: 'Maria Antiga', status: 'contato',
      ownerId: 'broker-b', phone: '(19) 99546-1826', phone2: null, lastContactAt, createdAt: new Date(0), externalLeadId: null,
    })

    await expect(ctx.googleAds.receive(token, googleBody(key))).resolves.toEqual({})

    expect(ctx.db.lead.rows).toHaveLength(1)
    expect(ctx.db.lead.rows[0].lastContactAt).toBe(lastContactAt)
    const interaction = ctx.db.interaction.rows[0]
    expect(interaction).toMatchObject({ leadId: 'old-lead', type: 'outro' })
    expect(interaction.notes).toMatch(/^Novo contato recebido via Google Ads: /)
    const task = ctx.db.task.rows[0]
    expect(task).toMatchObject({ title: 'Responder novo contato de Maria Antiga (Google Ads)', priority: 'alta', assignedTo: 'broker-b' })

    // Reenvio do mesmo lead_id: nada novo
    await ctx.googleAds.receive(token, googleBody(key))
    expect(ctx.db.interaction.rows).toHaveLength(1)
    expect(ctx.db.task.rows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- distribuição

describe('distribuição', () => {
  it('escolhe quem recebeu menos nas últimas 24 horas; empate vai para quem recebeu há mais tempo', async () => {
    const ctx = setup()
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)
    ctx.db.lead.rows.push(
      { id: 'a1', organizationId: ORG, ownerId: 'broker-a', externalLeadId: 'x1', createdAt: hoursAgo(1) },
      { id: 'a2', organizationId: ORG, ownerId: 'broker-a', externalLeadId: 'x2', createdAt: hoursAgo(2) },
      { id: 'b1', organizationId: ORG, ownerId: 'broker-b', externalLeadId: 'x3', createdAt: hoursAgo(3) },
      // Manual (sem externalLeadId) não conta
      { id: 'b2', organizationId: ORG, ownerId: 'broker-b', externalLeadId: null, createdAt: hoursAgo(1) },
      { id: 'b3', organizationId: ORG, ownerId: 'broker-b', externalLeadId: null, createdAt: hoursAgo(1) },
    )
    expect(await ctx.intake.pickAssignee(ORG, ['broker-a', 'broker-b'], 'manager')).toBe('broker-b')

    ctx.db.lead.rows.push({ id: 'b4', organizationId: ORG, ownerId: 'broker-b', externalLeadId: 'x4', createdAt: hoursAgo(0.5) })
    // 2 x 2: quem recebeu há mais tempo é a Ana (último há 1h, o Bruno há 30 min)
    expect(await ctx.intake.pickAssignee(ORG, ['broker-a', 'broker-b'], 'manager')).toBe('broker-a')
  })

  it('ignora usuários inativos ou de outra organização e cai no createdBy sem lista', async () => {
    const ctx = setup()
    ctx.db.user.rows.push({ id: 'inactive', organizationId: ORG, active: false, role: 'corretor' })
    expect(await ctx.intake.pickAssignee(ORG, ['inactive', 'ghost'], 'manager')).toBe('manager')
    expect(await ctx.intake.pickAssignee(ORG, [], 'broker-b')).toBe('broker-b')
  })

  it('alterna entre dois corretores ao receber vários leads', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx, { assignment: { userIds: ['broker-a', 'broker-b'] } })
    for (let index = 0; index < 4; index++) {
      await ctx.googleAds.receive(token, googleBody(key, {
        lead_id: `L${index}`,
        user_column_data: [
          { column_id: 'FULL_NAME', string_value: `Cliente ${index}` },
          { column_id: 'PHONE_NUMBER', string_value: `+55199900000${index}0` },
        ],
      }))
      // Garante createdAt diferente entre os leads
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(ctx.db.lead.rows.map((lead) => lead.ownerId)).toEqual(['broker-a', 'broker-b', 'broker-a', 'broker-b'])
  })

  it('não aceita configurar usuário inativo ou de outra organização', async () => {
    const ctx = setup()
    await expect(ctx.googleAds.enable(manager, { assignment: { userIds: ['broker-a', 'ghost'] } })).rejects.toMatchObject({ status: 400 })
  })

  it('sem API_PUBLIC_URL, a ativação devolve erro claro', async () => {
    const ctx = setup({ API_PUBLIC_URL: undefined })
    await expect(ctx.googleAds.enable(manager, {})).rejects.toThrow(/API_PUBLIC_URL não configurada/)
  })
})

// ---------------------------------------------------------------- status e perfis

describe('status e acesso', () => {
  const google = { provider: 'google_ads' as const, comingSoon: false }

  it('calcula desativada, aguardando, ativa, erro e em breve', () => {
    expect(computeStatus(google, null)).toBe('desativada')
    expect(computeStatus(google, { enabled: false, lastEventAt: new Date(), lastError: null })).toBe('desativada')
    expect(computeStatus(google, { enabled: true, lastEventAt: null, lastError: null })).toBe('aguardando')
    expect(computeStatus(google, { enabled: true, lastEventAt: new Date(), lastError: null })).toBe('ativa')
    expect(computeStatus(google, { enabled: true, lastEventAt: new Date(), lastError: 'Chave inválida' })).toBe('erro')
    expect(computeStatus({ provider: 'meta', comingSoon: true }, null)).toBe('em_breve')
  })

  it('erro seguido de ok volta a ativa; catálogo mostra os "em breve" com requisitos', async () => {
    const ctx = setup()
    const { token, key } = await enableGoogle(ctx)
    expect((await ctx.catalog.catalog(ORG)).find((item) => item.provider === 'google_ads')?.status).toBe('aguardando')
    await ctx.googleAds.receive(token, googleBody('errada')).catch(() => undefined)
    expect((await ctx.catalog.catalog(ORG)).find((item) => item.provider === 'google_ads')?.status).toBe('erro')
    await ctx.googleAds.receive(token, googleBody(key))
    const items = await ctx.catalog.catalog(ORG)
    expect(items.find((item) => item.provider === 'google_ads')?.status).toBe('ativa')
    expect(items.find((item) => item.provider === 'ai')?.status).toBe('ativa')
    const olx = items.find((item) => item.provider === 'grupo_olx')!
    expect(olx.status).toBe('em_breve')
    expect(olx.requirements).toContain('Fotos dos imóveis (mínimo 5)')
  })

  it('corretor recebe 403 em /integrations; gerente e diretor passam', () => {
    const guard = new RolesGuard(new Reflector())
    const context = (role: string) =>
      ({
        getHandler: () => Object.getOwnPropertyDescriptor(IntegrationsController.prototype, 'catalog')?.value as unknown,
        getClass: () => IntegrationsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext
    expect(() => guard.canActivate(context('corretor'))).toThrow(ForbiddenException)
    expect(() => guard.canActivate(context('coordenador'))).toThrow(ForbiddenException)
    expect(guard.canActivate(context('gerente'))).toBe(true)
    expect(guard.canActivate(context('diretor'))).toBe(true)
  })
})

// ---------------------------------------------------------------- IA

describe('configuração de IA', () => {
  it('sem registro: tudo ligado com a chave do sistema', async () => {
    const ctx = setup({ 'gemini.apiKey': 'chave-do-sistema' })
    await expect(ctx.ai.resolve(ORG, 'leadScore')).resolves.toMatchObject({ apiKey: 'chave-do-sistema', ownKey: false })
  })

  it('recurso desligado devolve 403', async () => {
    const ctx = setup({ 'gemini.apiKey': 'chave-do-sistema' })
    await ctx.ai.update(manager, { features: { leadScore: false } })
    await expect(ctx.ai.resolve(ORG, 'leadScore')).rejects.toThrow('Recurso de IA desativado pelo gestor')
    await expect(ctx.ai.resolve(ORG, 'propertyCopy')).resolves.toBeDefined()
    await ctx.ai.update(manager, { enabled: false })
    await expect(ctx.ai.resolve(ORG, 'propertyCopy')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('usa a chave própria quando configurada e volta para a do sistema ao remover', async () => {
    const ctx = setup({ 'gemini.apiKey': 'chave-do-sistema', GEMINI_MODEL: 'gemini-2.5-flash' })
    await ctx.ai.saveKey(manager, 'AIzaSyChavePropria0000000000000000')
    await expect(ctx.ai.resolve(ORG, 'leadScore')).resolves.toEqual({
      apiKey: 'AIzaSyChavePropria0000000000000000',
      model: 'gemini-2.5-flash',
      ownKey: true,
    })
    const view = await ctx.ai.removeKey(manager)
    expect(view).toMatchObject({ hasOwnKey: false, useOwnKey: false })
    await expect(ctx.ai.resolve(ORG, 'leadScore')).resolves.toMatchObject({ apiKey: 'chave-do-sistema' })
  })
})
