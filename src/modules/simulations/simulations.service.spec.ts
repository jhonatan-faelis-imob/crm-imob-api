import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SimulationsService } from './simulations.service'

type Row = {
  id: string
  kind: string
  title: string
  city: string
  neighborhood: string | null
  propertyStatus: string | null
  startingPrice: Prisma.Decimal | null
  price: Prisma.Decimal | null
  minIncome: Prisma.Decimal | null
  maxIncome: Prisma.Decimal | null
}

function row(id: string, kind: 'empreendimento' | 'revenda', value: number, extra: Partial<Row> = {}): Row {
  const decimal = new Prisma.Decimal(value)
  return {
    id,
    kind,
    title: id,
    city: 'São Paulo',
    neighborhood: null,
    propertyStatus: null,
    startingPrice: kind === 'empreendimento' ? decimal : null,
    price: kind === 'revenda' ? decimal : null,
    minIncome: null,
    maxIncome: null,
    ...extra,
  }
}

function setup(rows: Row[]) {
  // Devolve as linhas da faixa pedida, como o banco faria
  const findMany = jest.fn(({ where }: { where: { AND: [unknown, Record<string, unknown>] } }) => {
    const band = where.AND[1]
    const column = band.kind === 'empreendimento' ? 'startingPrice' : 'price'
    const range = band[column] as { gt?: number; lte: number }
    return Promise.resolve(
      rows.filter((item) => {
        const value = item[column]
        if (item.kind !== band.kind || value === null) return false
        const price = Number(value)
        return price <= range.lte && (range.gt === undefined || price > range.gt)
      }),
    )
  })
  const prisma = { property: { findMany, count: jest.fn().mockResolvedValue(0) } }
  return { findMany, service: new SimulationsService(prisma as unknown as PrismaService) }
}

describe('SimulationsService.calculate', () => {
  const body = { income: 4000, fgts: 10000, ownResources: 5000 }

  it('classifica e ordena: cabe antes de quase, preço decrescente', async () => {
    const { service } = setup([
      row('rev-150', 'revenda', 150000),
      row('emp-160', 'empreendimento', 160000, { minIncome: new Prisma.Decimal(3000), maxIncome: new Prisma.Decimal(5000) }),
      row('emp-180', 'empreendimento', 180000),
      row('rev-170', 'revenda', 170000),
      row('emp-300', 'empreendimento', 300000),
    ])
    const result = await service.calculate('org', body)

    expect(result.properties.items.map((item) => [item.id, item.fit])).toEqual([
      ['emp-160', 'cabe'],
      ['rev-150', 'cabe'],
      ['emp-180', 'quase'],
      ['rev-170', 'quase'],
    ])
    expect(result.properties.items[0]).toMatchObject({ priceLabel: 'a partir de', incomeMatch: true })
    expect(result.properties.items[1]).toMatchObject({ priceLabel: 'valor', incomeMatch: false })
  })

  it('inclui propertyStatus nulo e filtra por organização', async () => {
    const { findMany, service } = setup([row('sem-status', 'empreendimento', 100000)])
    const result = await service.calculate('org', body)

    expect(result.properties.items.map((item) => item.id)).toEqual(['sem-status'])
    const available = findMany.mock.calls[0][0].where.AND[0] as { AND: unknown[] }
    expect(available.AND).toEqual([
      { organizationId: 'org', active: true, sold: false },
      { OR: [{ propertyStatus: null }, { propertyStatus: { notIn: ['esgotado', 'suspenso', 'vendido'] } }] },
    ])
  })

  it('sem includeProperties não consulta imóveis', async () => {
    const { findMany, service } = setup([])
    const result = await service.calculate('org', { ...body, includeProperties: false })
    expect(findMany).not.toHaveBeenCalled()
    expect(result.inputs).toMatchObject({ commitmentPct: 30, termFactor: 108, financingPct: 80, useFgts: true })
  })

  it('renda zero vira 400', async () => {
    const { service } = setup([])
    await expect(service.calculate('org', { income: 0 })).rejects.toBeInstanceOf(BadRequestException)
  })
})
