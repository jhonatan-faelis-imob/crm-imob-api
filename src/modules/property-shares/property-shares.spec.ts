import { BadRequestException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { InteractionsService } from '../interactions/interactions.service'
import { LeadsService } from '../leads/leads.service'
import { PropertySharesService, type ShareUser } from './property-shares.service'
import {
  buildPublicShare,
  generateShareToken,
  isBotUserAgent,
  publicLocation,
  type PublicShare,
  type PublicShareProperty,
} from './public-share'

const ORG = 'org-1'
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111'
const LEAD_ID = '22222222-2222-4222-8222-222222222222'
const user: ShareUser = { id: 'user-1', organizationId: ORG, role: 'corretor', teamId: null }

const SECRET = 'SEGREDO-INTERNO'
const FORBIDDEN_KEYS = [
  'complement',
  'cep',
  'internalNotes',
  'commissionPct',
  'exclusive',
  'sellerLeadId',
  'ownerId',
  'minIncome',
  'maxIncome',
  'organizationId',
  'leadId',
  'createdBy',
  'token',
]

function publicProperty(overrides: Partial<PublicShareProperty> = {}): PublicShareProperty {
  return {
    kind: 'revenda',
    code: 'CS-01',
    title: 'Apartamento no Centro',
    description: 'Apartamento amplo e bem iluminado, perto de tudo.',
    propertyType: 'apartamento',
    propertyStatus: 'disponivel',
    sold: false,
    active: true,
    price: 350000,
    startingPrice: null,
    maxPrice: null,
    totalUnits: null,
    address: 'Rua Augusta',
    streetNumber: '1200',
    neighborhood: 'Consolação',
    city: 'São Paulo',
    state: 'SP',
    portalAddressDisplay: 'street',
    areaM2: 58,
    lotAreaM2: null,
    bedrooms: 2,
    suites: 1,
    bathrooms: 1,
    parkingSpots: 1,
    unitFloor: 5,
    buildingFloors: 12,
    yearBuilt: 2010,
    condoFee: 600,
    iptuValue: 1200,
    iptuPeriod: 'anual',
    acceptsFgts: true,
    acceptsFinancing: true,
    features: ['Pool', 'Elevator', 'Inexistente'],
    ...overrides,
  }
}

function allKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, keys))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key)
      allKeys(child, keys)
    }
  }
  return keys
}

// ---------------- Prisma falso em memória ----------------

interface ShareRow {
  id: string
  organizationId: string
  propertyId: string
  leadId: string | null
  createdBy: string | null
  token: string
  showPrice: boolean
  expiresAt: Date | null
  revokedAt: Date | null
  sentAt: Date | null
  viewCount: number
  firstViewedAt: Date | null
  lastViewedAt: Date | null
  createdAt: Date
}

type DbProperty = PublicShareProperty & { id: string; organizationId: string; complement: string; cep: string; internalNotes: string }

function setup({ property = {}, leadAccess = true }: { property?: Partial<DbProperty>; leadAccess?: boolean } = {}) {
  const dbProperty: DbProperty = {
    ...publicProperty(),
    id: PROPERTY_ID,
    organizationId: ORG,
    complement: `Apto 52 ${SECRET}`,
    cep: '01310-100',
    internalNotes: SECRET,
    ...property,
  }
  const shares: ShareRow[] = []
  const interactions: { leadId: string; notes: string; createdAt: Date }[] = []
  let seq = 0

  const matchShare = (row: ShareRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return true
      if (key === 'firstViewedAt') return row.firstViewedAt === value
      return (row as unknown as Record<string, unknown>)[key] === value
    })

  const prisma = {
    property: {
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string; active?: boolean } }) =>
        Promise.resolve(
          where.id === dbProperty.id &&
            where.organizationId === dbProperty.organizationId &&
            (where.active === undefined || where.active === dbProperty.active)
            ? dbProperty
            : null,
        ),
      ),
    },
    propertyShare: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> & { expiresAt?: unknown } }) => {
        const now = Date.now()
        const row = shares
          .filter((item) => matchShare(item, where))
          .filter((item) => !('OR' in where) || item.expiresAt === null || item.expiresAt.getTime() > now)
          .pop()
        return Promise.resolve(row ? { ...row, property: { title: dbProperty.title } } : null)
      }),
      findUnique: jest.fn(({ where }: { where: { token: string } }) => {
        const row = shares.find((item) => item.token === where.token)
        return Promise.resolve(
          row ? { ...row, organization: { name: 'Imobiliária Teste' }, property: dbProperty } : null,
        )
      }),
      create: jest.fn(({ data }: { data: Partial<ShareRow> }) => {
        const row: ShareRow = {
          id: `share-${(seq += 1)}`,
          organizationId: ORG,
          propertyId: PROPERTY_ID,
          leadId: null,
          createdBy: null,
          token: '',
          showPrice: true,
          expiresAt: null,
          revokedAt: null,
          sentAt: null,
          viewCount: 0,
          firstViewedAt: null,
          lastViewedAt: null,
          createdAt: new Date(),
          ...data,
        }
        shares.push(row)
        return Promise.resolve(row)
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = shares.find((item) => item.id === where.id) as ShareRow
        for (const [key, value] of Object.entries(data)) {
          if (key === 'viewCount') row.viewCount += (value as { increment: number }).increment
          else (row as unknown as Record<string, unknown>)[key] = value
        }
        return Promise.resolve(row)
      }),
      updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = shares.filter((item) => matchShare(item, where))
        rows.forEach((row) => Object.assign(row, data))
        return Promise.resolve({ count: rows.length })
      }),
    },
    interaction: {
      findFirst: jest.fn(({ where }: { where: { leadId: string; notes: { contains: string }; createdAt: { gte: Date } } }) =>
        Promise.resolve(
          interactions.find(
            (item) =>
              item.leadId === where.leadId &&
              item.notes.includes(where.notes.contains) &&
              item.createdAt >= where.createdAt.gte,
          ) ?? null,
        ),
      ),
    },
    leadProperty: { create: jest.fn(() => Promise.resolve({})) },
    user: {
      findFirst: jest.fn(() => Promise.resolve({ name: 'Ana Corretora', creci: '12345-F', phone: '', avatarUrl: null })),
    },
  }

  const leads = {
    assertLeadAccess: jest.fn(() =>
      leadAccess ? Promise.resolve({ id: LEAD_ID }) : Promise.reject(new ForbiddenException('Acesso negado')),
    ),
  }
  const interactionsService = {
    create: jest.fn((_org: string, _user: string, dto: { leadId: string; notes: string }) => {
      interactions.push({ leadId: dto.leadId, notes: dto.notes, createdAt: new Date() })
      return Promise.resolve({})
    }),
  }
  const config = { get: jest.fn(() => 'https://app.crmimob.com.br') }

  const service = new PropertySharesService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    leads as unknown as LeadsService,
    interactionsService as unknown as InteractionsService,
  )
  return { service, prisma, shares, interactionsService, dbProperty }
}

// ---------------- Testes ----------------

describe('token', () => {
  it('tem 32 caracteres base64url e não se repete', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateShareToken()))
    expect(tokens.size).toBe(2000)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})

const ALLOWED_TOP_LEVEL_KEYS = [
  'broker',
  'code',
  'conditions',
  'constructionStatusLabel',
  'description',
  'expiresAt',
  'features',
  'kind',
  'location',
  'maxPrice',
  'organization',
  'photos',
  'price',
  'priceLabel',
  'specs',
  'status',
  'title',
  'totalUnits',
  'typeLabel',
]

describe('carga pública', () => {
  it('tem exatamente as chaves permitidas (inclui o código)', async () => {
    const { service } = setup()
    const { token } = await service.create(user, { propertyId: PROPERTY_ID })
    const payload = (await service.getPublic(token)) as PublicShare
    expect(Object.keys(payload).sort()).toEqual(ALLOWED_TOP_LEVEL_KEYS)
    expect(payload.code).toBe('CS-01')
  })

  it('não contém nenhuma chave proibida nem dado interno (pela API)', async () => {
    const { service } = setup()
    const { token } = await service.create(user, { propertyId: PROPERTY_ID })
    const payload = await service.getPublic(token)
    const keys = allKeys(payload)
    for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden)
    const json = JSON.stringify(payload)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('01310-100')
    expect(json).not.toContain(ORG)
    expect(json).not.toContain('Apto 52')
  })

  it('3 modos de endereço', () => {
    const base = publicProperty()
    expect(publicLocation({ ...base, portalAddressDisplay: 'full' }).line).toBe('Rua Augusta, 1200')
    expect(publicLocation({ ...base, portalAddressDisplay: 'street' }).line).toBe('Rua Augusta')
    const neighborhood = publicLocation({ ...base, portalAddressDisplay: 'neighborhood' })
    expect(neighborhood.line).toBeNull()
    expect(neighborhood.mapUrl).not.toContain('Augusta')
    expect(neighborhood.mapUrl).toContain(encodeURIComponent('Consolação, São Paulo, SP'))
  })

  it('showPrice = false oculta price e maxPrice', () => {
    const development = publicProperty({ kind: 'empreendimento', startingPrice: 300000, maxPrice: 500000, price: null })
    const visible = buildPublicShare({ property: development, showPrice: true, broker: null, organizationName: 'X', expiresAt: null }) as PublicShare
    expect(visible).toMatchObject({ price: 300000, maxPrice: 500000, priceLabel: 'a partir de' })
    const hidden = buildPublicShare({ property: development, showPrice: false, broker: null, organizationName: 'X', expiresAt: null }) as PublicShare
    expect(hidden.price).toBeNull()
    expect(hidden.maxPrice).toBeNull()
  })

  it('rótulos de tipo e características vêm do portal.config, telefone vazio vira null', async () => {
    const { service } = setup()
    const { token } = await service.create(user, { propertyId: PROPERTY_ID })
    const payload = (await service.getPublic(token)) as PublicShare
    expect(payload.typeLabel).toBe('Apartamento')
    expect(payload.features).toEqual([
      { value: 'Pool', label: 'Piscina' },
      { value: 'Elevator', label: 'Elevador' },
    ])
    expect(payload.broker).toMatchObject({ name: 'Ana Corretora', phone: null })
    expect(payload.photos).toEqual([])
  })
})

describe('acesso público', () => {
  it('404 para inexistente e revogado (mesma resposta)', async () => {
    const { service } = setup()
    await expect(service.getPublic('nao-existe')).rejects.toBeInstanceOf(NotFoundException)
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    await service.revoke(user, share.id)
    await expect(service.getPublic(share.token)).rejects.toThrow('Link inválido')
  })

  it('410 para expirado', async () => {
    const { service, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    shares[0].expiresAt = new Date(Date.now() - 1000)
    await expect(service.getPublic(share.token)).rejects.toBeInstanceOf(GoneException)
  })

  it('imóvel inativo responde indisponivel sem nenhum dado dele', async () => {
    const { service, dbProperty } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    dbProperty.active = false
    const payload = await service.getPublic(share.token)
    expect(payload.status).toBe('indisponivel')
    expect(Object.keys(payload).sort()).toEqual(['broker', 'expiresAt', 'organization', 'status'])
    expect(JSON.stringify(payload)).not.toContain('Augusta')
  })

  it('imóvel vendido (inativo pela venda) mostra o selo vendido', async () => {
    const { service, dbProperty } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    Object.assign(dbProperty, { sold: true, active: false })
    expect((await service.getPublic(share.token)).status).toBe('vendido')
  })
})

describe('visualizações', () => {
  const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

  it('robô não conta', async () => {
    const { service, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    for (const agent of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1', 'curl/8.0', 'HeadlessChrome', undefined]) {
      await service.recordView(share.token, agent)
    }
    expect(shares[0].viewCount).toBe(0)
    expect(isBotUserAgent(BROWSER)).toBe(false)
  })

  it('navegador conta e firstViewedAt é gravado uma vez só', async () => {
    const { service, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    await service.recordView(share.token, BROWSER)
    const first = shares[0].firstViewedAt
    await new Promise((resolve) => setTimeout(resolve, 5))
    await service.recordView(share.token, BROWSER)
    expect(shares[0].viewCount).toBe(2)
    expect(shares[0].firstViewedAt).toBe(first)
    expect(shares[0].lastViewedAt?.getTime()).toBeGreaterThan(first?.getTime() ?? 0)
  })

  it('link revogado ou expirado não conta', async () => {
    const { service, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    shares[0].revokedAt = new Date()
    await service.recordView(share.token, BROWSER)
    expect(shares[0].viewCount).toBe(0)
  })
})

describe('criação do link', () => {
  it('reaproveita o link do mesmo trio e renova o prazo e o showPrice', async () => {
    const { service, shares } = setup()
    const first = await service.create(user, { propertyId: PROPERTY_ID, leadId: LEAD_ID, expiresInDays: 7 })
    const second = await service.create(user, { propertyId: PROPERTY_ID, leadId: LEAD_ID, expiresInDays: 90, showPrice: false })
    expect(second.id).toBe(first.id)
    expect(second.token).toBe(first.token)
    expect(shares).toHaveLength(1)
    expect(second.showPrice).toBe(false)
    expect(second.expiresAt!.getTime() - first.expiresAt!.getTime()).toBeGreaterThan(80 * 24 * 60 * 60 * 1000)
    expect(second.url).toBe(`https://app.crmimob.com.br/i/${first.token}`)

    // Link geral é outro trio
    const general = await service.create(user, { propertyId: PROPERTY_ID })
    expect(general.id).not.toBe(first.id)
  })

  it('imóvel de outra organização retorna 404', async () => {
    const { service } = setup()
    await expect(service.create({ ...user, organizationId: 'outra' }, { propertyId: PROPERTY_ID })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('imóvel vendido não gera link', async () => {
    const { service } = setup({ property: { propertyStatus: 'vendido' } })
    await expect(service.create(user, { propertyId: PROPERTY_ID })).rejects.toThrow('Imóvel vendido não pode ser compartilhado')
    const sold = setup({ property: { sold: true } })
    await expect(sold.service.create(user, { propertyId: PROPERTY_ID })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('usuário sem acesso ao lead não gera link para ele', async () => {
    const { service, shares } = setup({ leadAccess: false })
    await expect(service.create(user, { propertyId: PROPERTY_ID, leadId: LEAD_ID })).rejects.toBeInstanceOf(ForbiddenException)
    expect(shares).toHaveLength(0)
  })
})

describe('mark-sent', () => {
  it('não duplica a interação em 2 minutos e vincula o imóvel', async () => {
    const { service, interactionsService, prisma, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID, leadId: LEAD_ID })
    const first = await service.markSent(user, share.id, { channel: 'whatsapp', linkToLead: true })
    const second = await service.markSent(user, share.id, { channel: 'whatsapp', linkToLead: true })
    expect(first.interactionCreated).toBe(true)
    expect(second.interactionCreated).toBe(false)
    expect(interactionsService.create).toHaveBeenCalledTimes(1)
    expect(interactionsService.create.mock.calls[0][2]).toMatchObject({
      leadId: LEAD_ID,
      type: 'whatsapp',
      notes: `Imóvel enviado: Apartamento no Centro (${share.url})`,
    })
    expect(prisma.leadProperty.create).toHaveBeenCalled()
    expect(shares[0].sentAt).not.toBeNull()
  })

  it('channel link só grava sentAt, sem interação', async () => {
    const { service, interactionsService, shares } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID, leadId: LEAD_ID })
    await service.markSent(user, share.id, { channel: 'link' })
    expect(interactionsService.create).not.toHaveBeenCalled()
    expect(shares[0].sentAt).not.toBeNull()
  })

  it('outro corretor não revoga nem marca o link de alguém', async () => {
    const { service } = setup()
    const share = await service.create(user, { propertyId: PROPERTY_ID })
    const other: ShareUser = { ...user, id: 'user-2' }
    await expect(service.revoke(other, share.id)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.revoke({ ...other, role: 'gerente' }, share.id)).resolves.toMatchObject({ id: share.id })
  })
})
