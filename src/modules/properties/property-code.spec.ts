import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CODE_CHANGED_WARNING, PropertiesService } from './properties.service'
import { PROPERTY_CODE_MESSAGE, formatPropertyCode, normalizePropertyCode, planCodeBackfill } from './property-code'

const ORG = 'org-1'

describe('normalizePropertyCode', () => {
  it('cs-01 vira CS-01 e 00012 é aceito', () => {
    expect(normalizePropertyCode('  cs-01 ')).toBe('CS-01')
    expect(normalizePropertyCode('00012')).toBe('00012')
    expect(normalizePropertyCode('ap.01/b_2')).toBe('AP.01/B_2')
  })

  it('vazio vira "sem código"', () => {
    expect(normalizePropertyCode('')).toBeNull()
    expect(normalizePropertyCode('   ')).toBeNull()
    expect(normalizePropertyCode(null)).toBeNull()
    expect(normalizePropertyCode(undefined)).toBeNull()
  })

  it('espaço no meio, caractere fora da lista e 21 caracteres são rejeitados', () => {
    expect(() => normalizePropertyCode('AP 01')).toThrow(PROPERTY_CODE_MESSAGE)
    expect(() => normalizePropertyCode('AP#01')).toThrow(BadRequestException)
    expect(() => normalizePropertyCode('-AP01')).toThrow(BadRequestException)
    expect(() => normalizePropertyCode('A'.repeat(21))).toThrow(BadRequestException)
    expect(normalizePropertyCode('A'.repeat(20))).toBe('A'.repeat(20))
  })

  it('passar de 99999 não quebra', () => {
    expect(formatPropertyCode(1)).toBe('00001')
    expect(formatPropertyCode(100000)).toBe('100000')
  })
})

describe('planCodeBackfill', () => {
  it('numera na ordem recebida (createdAt, id) a partir da sequência e pula ocupados', () => {
    const plan = planCodeBackfill([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, ['00004', 'CS-01'])
    expect(plan.assignments).toEqual([
      { id: 'a', code: '00003' },
      { id: 'b', code: '00005' },
      { id: 'c', code: '00006' },
    ])
    expect(plan.sequence).toBe(6)
  })

  it('é idempotente: sem imóveis sem código, nada muda', () => {
    expect(planCodeBackfill([], 6, ['00003'])).toEqual({ assignments: [], sequence: 6 })
  })
})

// ---------------- PropertiesService com Prisma falso em memória ----------------

interface Row {
  id: string
  organizationId: string
  kind: string
  code: string | null
  title: string
  city: string
  publishToPortals: boolean
  active: boolean
  createdAt: Date
}

function setup(initial: Partial<Row>[] = []) {
  const rows: Row[] = initial.map((row, index) => ({
    id: `p${index}`,
    organizationId: ORG,
    kind: 'revenda',
    code: null,
    title: `Imóvel ${index}`,
    city: 'Santos',
    publishToPortals: false,
    active: true,
    createdAt: new Date(2026, 0, index + 1),
    ...row,
  }))
  const organization = { id: ORG, propertyCodeSeq: 0 }
  let seq = rows.length

  // Só os filtros que o service usa: organizationId, code (igual ou contains), NOT id, AND
  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'AND') return (value as Record<string, unknown>[]).every((part) => matches(row, part))
      if (key === 'OR') return (value as Record<string, unknown>[]).some((part) => matches(row, part))
      if (key === 'NOT') return !matches(row, value as Record<string, unknown>)
      const field = (row as unknown as Record<string, unknown>)[key]
      if (value !== null && typeof value === 'object' && 'contains' in value) {
        return typeof field === 'string' && field.toLowerCase().includes(String((value as { contains: string }).contains).toLowerCase())
      }
      if (value !== null && typeof value === 'object' && 'in' in value) return (value as { in: unknown[] }).in.includes(field)
      return field === value
    })
  }

  const property = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    ),
    count: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(rows.filter((row) => matches(row, where)).length)),
    create: jest.fn(({ data }: { data: Partial<Row> }) => {
      if (data.code && rows.some((row) => row.organizationId === data.organizationId && row.code === data.code)) {
        return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }))
      }
      seq += 1
      const row: Row = {
        id: `p${seq}`,
        organizationId: ORG,
        kind: 'revenda',
        code: null,
        title: '',
        city: '',
        publishToPortals: false,
        active: true,
        createdAt: new Date(2026, 1, seq),
        ...data,
      }
      rows.push(row)
      return Promise.resolve(row)
    }),
    update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const row = rows.find((item) => item.id === where.id)
      if (!row) return Promise.reject(new Error('não encontrado'))
      Object.assign(row, data)
      return Promise.resolve({ ...row })
    }),
  }
  const base = {
    property,
    organization: {
      update: jest.fn(() => {
        organization.propertyCodeSeq += 1
        return Promise.resolve({ propertyCodeSeq: organization.propertyCodeSeq })
      }),
      findUnique: jest.fn(() => Promise.resolve({ propertyCodeSeq: organization.propertyCodeSeq })),
    },
    lead: { findFirst: jest.fn(() => Promise.resolve(null)) },
  }
  const prisma = { ...base, $transaction: jest.fn((fn: (tx: typeof base) => Promise<unknown>) => fn(base)) }
  return { rows, organization, service: new PropertiesService(prisma as unknown as PrismaService) }
}

const quick = { kind: 'revenda', title: 'Casa boa', city: 'Santos', price: 300000, propertyType: 'casa' }

describe('PropertiesService: geração do código', () => {
  it('dois cadastros seguidos recebem 00001 e 00002', async () => {
    const { service } = setup()
    const first = await service.create(ORG, 'u1', quick)
    const second = await service.create(ORG, 'u1', quick)
    expect([first.code, second.code]).toEqual(['00001', '00002'])
  })

  it('se 00003 já existe (digitado), o automático pula para 00004', async () => {
    const { service, organization } = setup([{ code: '00003', title: 'Sobrado digitado' }])
    organization.propertyCodeSeq = 2
    const created = await service.create(ORG, 'u1', quick)
    expect(created.code).toBe('00004')
    expect(organization.propertyCodeSeq).toBe(4)
  })

  it('cinco cadastros seguidos têm códigos diferentes', async () => {
    const { service } = setup()
    const codes: (string | null)[] = []
    for (let index = 0; index < 5; index += 1) codes.push((await service.create(ORG, 'u1', quick)).code)
    expect(new Set(codes).size).toBe(5)
  })

  it('código manual é normalizado e o duplicado devolve 409 com o título de quem usa', async () => {
    const { service } = setup([{ code: 'CS-01', title: 'Casa da praia' }])
    await expect(service.create(ORG, 'u1', { ...quick, code: 'cs-01' })).rejects.toThrow(
      'Código "CS-01" já está em uso pelo imóvel "Casa da praia"',
    )
    const created = await service.create(ORG, 'u1', { ...quick, code: 'ap-01' })
    expect(created.code).toBe('AP-01')
  })

  it('código inválido devolve 400', async () => {
    const { service } = setup()
    await expect(service.create(ORG, 'u1', { ...quick, code: 'AP 01' })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('dica do próximo código pula os ocupados e não reserva nada', async () => {
    const { service, organization } = setup([{ code: '00001' }])
    expect(await service.nextCodeHint(ORG)).toEqual({ hint: '00002' })
    expect(organization.propertyCodeSeq).toBe(0)
  })
})

describe('PropertiesService: edição do código', () => {
  it('sem code ou vazio mantém o atual', async () => {
    const { service, rows } = setup([{ code: '00007' }])
    await service.update(ORG, 'p0', { title: 'Novo título' })
    await service.update(ORG, 'p0', { code: '' })
    await service.update(ORG, 'p0', { code: null })
    expect(rows[0].code).toBe('00007')
  })

  it('código repetido devolve 409 (ignorando o próprio imóvel)', async () => {
    const { service } = setup([{ code: 'CS-01', title: 'Casa A' }, { code: 'CS-02', title: 'Casa B' }])
    await expect(service.update(ORG, 'p1', { code: 'cs-01' })).rejects.toBeInstanceOf(ConflictException)
    await expect(service.update(ORG, 'p1', { code: 'CS-02' })).resolves.not.toHaveProperty('warning')
  })

  it('trocar o código de um imóvel publicado devolve o aviso', async () => {
    const { service } = setup([{ code: '00001', publishToPortals: true }, { code: '00002' }])
    expect(await service.update(ORG, 'p0', { code: 'AP-10' })).toMatchObject({ code: 'AP-10', warning: CODE_CHANGED_WARNING })
    expect(await service.update(ORG, 'p1', { code: 'AP-11' })).not.toHaveProperty('warning')
  })
})

describe('PropertiesService: busca por código', () => {
  it('cs-01 encontra, parte do código encontra, e o código exato vem primeiro', async () => {
    const { service } = setup([
      { code: 'CS-010', title: 'Casa 10', createdAt: new Date(2026, 5, 1) },
      { code: 'CS-01', title: 'Casa 1', createdAt: new Date(2026, 0, 1) },
      { code: 'AP-01', title: 'Apto', createdAt: new Date(2026, 3, 1) },
    ])
    const exact = await service.findAll(ORG, { search: 'cs-01', page: 1, limit: 20 })
    expect(exact.data.map((item) => item.code)).toEqual(['CS-01', 'CS-010'])

    const partial = await service.findAll(ORG, { search: 'cs-0', page: 1, limit: 20 })
    expect(partial.data.map((item) => item.code).sort()).toEqual(['CS-01', 'CS-010'])
  })
})
