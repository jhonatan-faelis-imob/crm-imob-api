import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CalculateSimulationDto } from './dto/calculate-simulation.dto'
import { calculateSimulation, classifyProperty, isIncomeMatch } from './simulation.calculator'
import { SIMULATION_DEFAULTS } from './simulation.config'

const params = {
  commitmentPct: SIMULATION_DEFAULTS.commitmentPct,
  termFactor: SIMULATION_DEFAULTS.termFactor,
  financingPct: SIMULATION_DEFAULTS.financingPct,
}

describe('calculateSimulation', () => {
  it('renda 4.000, FGTS 10.000, recursos 5.000', () => {
    const result = calculateSimulation({ income: 4000, fgts: 10000, ownResources: 5000 }, params)
    expect(result.installment).toBe(1200)
    expect(result.financing).toBe(129600)
    expect(result.referenceValue).toBe(162000)
    expect(result.downPayment.total).toBe(32400)
    expect(result.downPayment.remaining).toBe(17400)
    expect(result.downPayment.surplus).toBe(0)
    expect(result.maxPurchaseValue).toBe(162000)
  })

  it('renda 4.000, FGTS 30.000, recursos 20.000: sobra e teto maior', () => {
    const result = calculateSimulation({ income: 4000, fgts: 30000, ownResources: 20000 }, params)
    expect(result.downPayment.surplus).toBe(17600)
    expect(result.downPayment.remaining).toBe(0)
    expect(result.maxPurchaseValue).toBe(179600)
  })

  it('soma a renda do cônjuge e avisa', () => {
    const result = calculateSimulation({ income: 3000, spouseIncome: 1000 }, params)
    expect(result.totalIncome).toBe(4000)
    expect(result.installment).toBe(1200)
    expect(result.warnings.map((warning) => warning.code)).toContain('renda_conjuge_somada')
  })

  it('conta o subsídio como recurso de entrada', () => {
    const result = calculateSimulation({ income: 4000, subsidy: 15000 }, params)
    expect(result.downPayment.subsidy).toBe(15000)
    expect(result.downPayment.remaining).toBe(17400)
  })

  it('com useFgts = false ignora o saldo', () => {
    const result = calculateSimulation({ income: 4000, fgts: 10000, ownResources: 5000, useFgts: false }, params)
    expect(result.downPayment.fgts).toBe(0)
    expect(result.downPayment.remaining).toBe(27400)
  })

  it('avisa quando o FGTS entra sem 3 anos de CLT marcados', () => {
    const withoutClt = calculateSimulation({ income: 4000, fgts: 10000, hasClt3Years: false }, params)
    expect(withoutClt.warnings.map((warning) => warning.code)).toEqual(['fgts_nao_confirmado'])
    const notUsed = calculateSimulation({ income: 4000, fgts: 10000, hasClt3Years: false, useFgts: false }, params)
    expect(notUsed.warnings).toEqual([])
  })

  it('recusa renda zero', () => {
    expect(() => calculateSimulation({ income: 0 }, params)).toThrow('Informe a renda')
  })

  it('respeita os parâmetros', () => {
    const result = calculateSimulation({ income: 4000 }, { commitmentPct: 25, termFactor: 200, financingPct: 90 })
    expect(result.installment).toBe(1000)
    expect(result.financing).toBe(200000)
    expect(result.referenceValue).toBe(222222.22)
  })
})

describe('classifyProperty', () => {
  const result = calculateSimulation({ income: 4000, fgts: 10000, ownResources: 5000 }, params)
  const options = { financingPct: 80, nearMarginPct: 15 }

  it('cabe até o teto, quase até +15% e fora acima disso', () => {
    expect(classifyProperty(150000, result, options).fit).toBe('cabe')
    expect(classifyProperty(162000, result, options).fit).toBe('cabe')
    expect(classifyProperty(186000, result, options).fit).toBe('quase')
    expect(classifyProperty(186300, result, options).fit).toBe('quase')
    expect(classifyProperty(186301, result, options).fit).toBeNull()
  })

  it('financia até 80% do imóvel, sem passar do financiamento possível', () => {
    // 100.000: financia 80.000, entrada 20.000, coberta pelos 15.000 → faltam 5.000
    expect(classifyProperty(100000, result, options)).toMatchObject({ downNeeded: 20000, downRemaining: 5000 })
    // 180.000: o financiamento para em 129.600
    expect(classifyProperty(180000, result, options)).toMatchObject({ downNeeded: 50400, downRemaining: 35400 })
  })

  it('renda ideal só com as duas pontas da faixa', () => {
    expect(isIncomeMatch(4000, 3000, 5000)).toBe(true)
    expect(isIncomeMatch(4000, null, 5000)).toBe(false)
    expect(isIncomeMatch(6000, 3000, 5000)).toBe(false)
  })
})

describe('CalculateSimulationDto', () => {
  async function errorsFor(body: object) {
    const errors = await validate(plainToInstance(CalculateSimulationDto, body))
    return errors.map((error) => error.property)
  }

  it('aceita o mínimo', async () => {
    expect(await errorsFor({ income: 4000 })).toEqual([])
  })

  it('recusa renda zero com a mensagem certa', async () => {
    const errors = await validate(plainToInstance(CalculateSimulationDto, { income: 0 }))
    expect(Object.values(errors[0].constraints ?? {})).toContain('Informe a renda')
  })

  it('recusa parâmetros fora da faixa', async () => {
    expect(await errorsFor({ income: 4000, commitmentPct: 60 })).toEqual(['commitmentPct'])
    expect(await errorsFor({ income: 4000, termFactor: 10 })).toEqual(['termFactor'])
    expect(await errorsFor({ income: 4000, financingPct: 99 })).toEqual(['financingPct'])
    expect(await errorsFor({ income: 2_000_000 })).toEqual(['income'])
    expect(await errorsFor({ income: 4000, fgts: -1 })).toEqual(['fgts'])
  })
})
