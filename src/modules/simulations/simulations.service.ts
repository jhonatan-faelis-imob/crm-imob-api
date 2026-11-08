import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CalculateSimulationDto } from './dto/calculate-simulation.dto'
import {
  SimulationInputError,
  calculateSimulation,
  classifyProperty,
  isIncomeMatch,
  nearLimit,
  type PropertyFit,
  type SimulationResult,
} from './simulation.calculator'
import {
  MAX_PROPERTIES,
  SIMULATION_DEFAULTS,
  SIMULATION_LIMITS,
  UNAVAILABLE_PROPERTY_STATUSES,
} from './simulation.config'

const PROPERTY_SELECT = {
  id: true,
  kind: true,
  code: true,
  title: true,
  city: true,
  neighborhood: true,
  propertyStatus: true,
  startingPrice: true,
  price: true,
  minIncome: true,
  maxIncome: true,
} satisfies Prisma.PropertySelect

type CandidateRow = Prisma.PropertyGetPayload<{ select: typeof PROPERTY_SELECT }>

// Empreendimento usa o "a partir de"; revenda, o valor pedido
const PRICE_COLUMN = { empreendimento: 'startingPrice', revenda: 'price' } as const
type PropertyKind = keyof typeof PRICE_COLUMN

function toNumber(value: Prisma.Decimal | null) {
  return value === null ? null : Number(value)
}

function priceRange(kind: PropertyKind, range: { gt?: number; lte: number }): Prisma.PropertyWhereInput {
  return { kind, [PRICE_COLUMN[kind]]: { not: null, ...range } }
}

@Injectable()
export class SimulationsService {
  constructor(private prisma: PrismaService) {}

  getConfig() {
    return { defaults: SIMULATION_DEFAULTS, limits: SIMULATION_LIMITS, maxProperties: MAX_PROPERTIES }
  }

  async calculate(organizationId: string, dto: CalculateSimulationDto) {
    const params = {
      commitmentPct: dto.commitmentPct ?? SIMULATION_DEFAULTS.commitmentPct,
      termFactor: dto.termFactor ?? SIMULATION_DEFAULTS.termFactor,
      financingPct: dto.financingPct ?? SIMULATION_DEFAULTS.financingPct,
    }
    const inputs = {
      income: dto.income,
      spouseIncome: dto.spouseIncome ?? 0,
      fgts: dto.fgts ?? 0,
      ownResources: dto.ownResources ?? 0,
      subsidy: dto.subsidy ?? 0,
      useFgts: dto.useFgts ?? true,
      hasClt3Years: dto.hasClt3Years ?? null,
      ...params,
      nearMarginPct: SIMULATION_DEFAULTS.nearMarginPct,
    }

    let result: SimulationResult
    try {
      result = calculateSimulation({ ...inputs, hasClt3Years: dto.hasClt3Years }, params)
    } catch (error) {
      if (error instanceof SimulationInputError) throw new BadRequestException(error.message)
      throw error
    }

    const properties =
      dto.includeProperties === false
        ? { items: [], counts: { cabe: 0, quase: 0 } }
        : await this.findFittingProperties(organizationId, result, params.financingPct)

    return {
      inputs: { ...inputs, totalIncome: result.totalIncome },
      installment: result.installment,
      financing: result.financing,
      referenceValue: result.referenceValue,
      maxPurchaseValue: result.maxPurchaseValue,
      downPayment: result.downPayment,
      warnings: result.warnings,
      properties,
    }
  }

  private async findFittingProperties(organizationId: string, result: SimulationResult, financingPct: number) {
    const max = result.maxPurchaseValue
    const near = nearLimit(max, SIMULATION_DEFAULTS.nearMarginPct)

    // propertyStatus é opcional e o notIn do Prisma deixaria os nulos de fora
    const available: Prisma.PropertyWhereInput = {
      AND: [
        { organizationId, active: true, sold: false },
        { OR: [{ propertyStatus: null }, { propertyStatus: { notIn: UNAVAILABLE_PROPERTY_STATUSES } }] },
      ],
    }
    const kinds: PropertyKind[] = ['empreendimento', 'revenda']
    const bands = { cabe: { lte: max }, quase: { gt: max, lte: near } }

    // Uma busca por tipo e faixa, cada uma já pelo preço decrescente: "cabe" nunca fica
    // de fora por causa de muitos "quase" mais caros
    const bandQuery = (band: PropertyFit) =>
      Promise.all(
        kinds.map((kind) =>
          this.prisma.property.findMany({
            where: { AND: [available, priceRange(kind, bands[band])] },
            select: PROPERTY_SELECT,
            orderBy: { [PRICE_COLUMN[kind]]: 'desc' },
            take: MAX_PROPERTIES,
          }),
        ),
      ).then((lists) => lists.flat())
    const bandCount = (band: PropertyFit) =>
      this.prisma.property.count({
        where: { AND: [available, { OR: kinds.map((kind) => priceRange(kind, bands[band])) }] },
      })

    const [fits, nears, cabe, quase] = await Promise.all([
      bandQuery('cabe'),
      bandQuery('quase'),
      bandCount('cabe'),
      bandCount('quase'),
    ])

    const toItem = (row: CandidateRow) => {
      const kind = row.kind as PropertyKind
      const referencePrice = toNumber(kind === 'empreendimento' ? row.startingPrice : row.price) ?? 0
      const { fit, downNeeded, downRemaining } = classifyProperty(referencePrice, result, {
        financingPct,
        nearMarginPct: SIMULATION_DEFAULTS.nearMarginPct,
      })
      return {
        id: row.id,
        kind: row.kind,
        code: row.code,
        title: row.title,
        city: row.city,
        neighborhood: row.neighborhood,
        propertyStatus: row.propertyStatus,
        referencePrice,
        priceLabel: kind === 'empreendimento' ? ('a partir de' as const) : ('valor' as const),
        fit,
        downNeeded,
        downRemaining,
        incomeMatch: isIncomeMatch(result.totalIncome, toNumber(row.minIncome), toNumber(row.maxIncome)),
      }
    }

    const byPriceDesc = (a: { referencePrice: number }, b: { referencePrice: number }) =>
      b.referencePrice - a.referencePrice
    const items = [
      ...fits.map(toItem).filter((item) => item.fit === 'cabe').sort(byPriceDesc),
      ...nears.map(toItem).filter((item) => item.fit === 'quase').sort(byPriceDesc),
    ].slice(0, MAX_PROPERTIES)

    return { items, counts: { cabe, quase } }
  }
}
