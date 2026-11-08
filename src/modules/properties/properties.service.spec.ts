import { BadRequestException, HttpException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PrismaService } from '../../prisma/prisma.service'
import { cutAtWord, parsePropertyDescription } from '../ai/property-description'
import { AiDescribeRateLimiter } from './ai-describe-rate-limiter'
import { CreatePropertyDto } from './dto/create-property.dto'
import { UpdatePropertyDto } from './dto/update-property.dto'
import { PropertiesService } from './properties.service'

const ORG = 'org-1'
const LEAD_ID = '6f1c3c1e-4b8a-4f43-9d55-2f6b7a1c9e10'

function setup({ leadInOrg = true, current = {} }: { leadInOrg?: boolean; current?: object } = {}) {
  const base = {
    lead: {
      findFirst: jest.fn(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(leadInOrg && where.organizationId === ORG ? { id: LEAD_ID } : null),
      ),
    },
    property: {
      create: jest.fn(({ data }: { data: object }) => Promise.resolve({ id: 'p1', ...data })),
      update: jest.fn(({ data }: { data: object }) => Promise.resolve({ id: 'p1', ...data })),
      // Busca pelo id devolve o imóvel atual; busca por código (gerador) não acha ninguém
      findFirst: jest.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(
          where.id ? { id: 'p1', organizationId: ORG, kind: 'revenda', title: 'Casa', city: 'Santos', code: null, ...current } : null,
        ),
      ),
    },
    organization: { update: jest.fn(() => Promise.resolve({ propertyCodeSeq: 1 })) },
  }
  // A transação roda o callback com o próprio Prisma falso
  const prisma = { ...base, $transaction: jest.fn((fn: (tx: typeof base) => Promise<unknown>) => fn(base)) }
  return { prisma, service: new PropertiesService(prisma as unknown as PrismaService) }
}

const quick = { kind: 'revenda', title: 'Casa boa', city: 'Santos', price: 300000, propertyType: 'casa' }

describe('PropertiesService: portais e proprietário', () => {
  it('cadastro rápido (título, tipo, cidade e valor) salva', async () => {
    const { service, prisma } = setup()
    await service.create(ORG, 'user-1', quick)
    expect(prisma.property.create).toHaveBeenCalled()
  })

  it('publicar sem estar completo retorna 400 com a lista do que falta', async () => {
    const { service, prisma } = setup()
    const error = await service.create(ORG, 'user-1', { ...quick, publishToPortals: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BadRequestException)
    const body = (error as BadRequestException).getResponse() as { message: string; missing: string[] }
    expect(body.message).toBe('Imóvel incompleto para os portais')
    expect(body.missing.length).toBeGreaterThan(0)
    expect(prisma.property.create).not.toHaveBeenCalled()
  })

  it('publicar no update avalia o salvo junto com as mudanças', async () => {
    const { service, prisma } = setup({ current: { kind: 'empreendimento' } })
    await expect(service.update(ORG, 'p1', { publishToPortals: true })).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.property.update).not.toHaveBeenCalled()
  })

  it('desligar a publicação é sempre permitido', async () => {
    const { service, prisma } = setup()
    await service.update(ORG, 'p1', { publishToPortals: false })
    expect(prisma.property.update).toHaveBeenCalled()
  })

  it('sellerLeadId de outra organização retorna 400', async () => {
    const { service } = setup({ leadInOrg: false })
    await expect(service.create(ORG, 'user-1', { ...quick, sellerLeadId: LEAD_ID })).rejects.toThrow(
      'Proprietário não encontrado nesta organização',
    )
  })

  it('kitnet sem quartos grava 0', async () => {
    const { service, prisma } = setup()
    await service.create(ORG, 'user-1', { ...quick, propertyType: 'kitnet' })
    expect(prisma.property.create.mock.calls[0][0]).toMatchObject({ data: { bedrooms: 0 } })
  })
})

describe('CreatePropertyDto / UpdatePropertyDto', () => {
  async function errors(body: object, dto: typeof CreatePropertyDto | typeof UpdatePropertyDto = CreatePropertyDto) {
    const result = await validate(plainToInstance(dto, body))
    return Object.fromEntries(result.map((error) => [error.property, Object.values(error.constraints ?? {})]))
  }

  it('característica fora da lista retorna erro', async () => {
    expect(await errors({ ...quick, features: ['Pool', 'Heliponto'] })).toHaveProperty('features')
    expect(await errors({ ...quick, features: ['Pool', 'Pool'] })).toHaveProperty('features')
    expect(await errors({ ...quick, features: ['Pool', 'BBQ'] })).toEqual({})
  })

  it('descrição com HTML retorna a mensagem certa', async () => {
    const result = await errors({ ...quick, description: '<b>texto</b>' })
    expect(result.description).toContain('A descrição não pode conter HTML')
  })

  it('título acima de 100 e ano fora da faixa', async () => {
    expect(await errors({ ...quick, title: 'a'.repeat(101) })).toHaveProperty('title')
    expect(await errors({ ...quick, yearBuilt: 1799 })).toHaveProperty('yearBuilt')
    expect(await errors({ ...quick, propertyType: 'castelo' })).toHaveProperty('propertyType')
  })

  it('empreendimento não ganha os limites de revenda', async () => {
    expect(await errors({ kind: 'empreendimento', title: 'a'.repeat(150), city: 'Santos' })).toEqual({})
  })

  it('trim no título e PATCH parcial valida', async () => {
    const dto = plainToInstance(CreatePropertyDto, { ...quick, title: '  Casa boa  ' })
    expect(dto.title).toBe('Casa boa')
    expect(await errors({ publishToPortals: null }, UpdatePropertyDto)).toHaveProperty('publishToPortals')
    expect(await errors({ price: -1 }, UpdatePropertyDto)).toHaveProperty('price')
  })
})

describe('IA: tratamento da resposta e limite', () => {
  it('remove cercas de código e corta o título na última palavra', () => {
    const title = `${'Apartamento amplo '.repeat(8)}fim`
    const parsed = parsePropertyDescription(`\`\`\`json\n${JSON.stringify({ title, description: 'Texto.' })}\n\`\`\``)
    expect(parsed.title.length).toBeLessThanOrEqual(100)
    expect(parsed.title.endsWith(' ')).toBe(false)
    expect(cutAtWord('abc def ghi', 9)).toBe('abc def')
  })

  it('JSON inválido lança erro de parse', () => {
    expect(() => parsePropertyDescription('não é json')).toThrow()
  })

  it('21ª chamada na mesma hora vira 429', () => {
    const limiter = new AiDescribeRateLimiter()
    for (let call = 0; call < 20; call += 1) limiter.consume('u1', 1000)
    let error: unknown = null
    try {
      limiter.consume('u1', 1000)
    } catch (caught: unknown) {
      error = caught
    }
    expect((error as HttpException).getStatus()).toBe(429)
    expect(() => limiter.consume('u1', 1000 + 60 * 60 * 1000)).not.toThrow()
  })
})
