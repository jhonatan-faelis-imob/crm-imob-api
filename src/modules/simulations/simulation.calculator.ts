// Cálculo puro da simulação: sem Nest nem Prisma, para testar direto

export interface SimulationParams {
  commitmentPct: number
  termFactor: number
  financingPct: number
}

export interface SimulationInput {
  income: number
  spouseIncome?: number
  fgts?: number
  ownResources?: number
  subsidy?: number
  useFgts?: boolean
  hasClt3Years?: boolean
}

export interface SimulationWarning {
  code: 'fgts_nao_confirmado' | 'renda_conjuge_somada'
  message: string
}

export interface SimulationResult {
  totalIncome: number
  installment: number
  financing: number
  referenceValue: number
  maxPurchaseValue: number
  coverage: number
  downPayment: {
    total: number
    fgts: number
    ownResources: number
    subsidy: number
    covered: number
    remaining: number
    surplus: number
  }
  warnings: SimulationWarning[]
}

export type PropertyFit = 'cabe' | 'quase'

export class SimulationInputError extends Error {}

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateSimulation(input: SimulationInput, params: SimulationParams): SimulationResult {
  const spouseIncome = input.spouseIncome && input.spouseIncome > 0 ? input.spouseIncome : 0
  const income = input.income + spouseIncome
  if (!(input.income > 0) || !(income > 0)) throw new SimulationInputError('Informe a renda')

  const useFgts = input.useFgts ?? true
  const fgts = useFgts ? (input.fgts ?? 0) : 0
  const ownResources = input.ownResources ?? 0
  const subsidy = input.subsidy ?? 0

  const installment = round2((income * params.commitmentPct) / 100)
  const financing = round2(installment * params.termFactor)
  const referenceValue = round2(financing / (params.financingPct / 100))
  const coverage = round2(fgts + ownResources + subsidy)
  const downTotal = round2(referenceValue - financing)
  const remaining = round2(Math.max(0, downTotal - coverage))
  const surplus = round2(Math.max(0, coverage - downTotal))
  const maxPurchaseValue = round2(Math.max(referenceValue, financing + coverage))

  const warnings: SimulationWarning[] = []
  if (useFgts && (input.fgts ?? 0) > 0 && input.hasClt3Years === false) {
    warnings.push({
      code: 'fgts_nao_confirmado',
      message:
        'Cadastro sem 3 anos de registro CLT marcados. Confirme o tempo de FGTS antes de contar com o saldo.',
    })
  }
  if (spouseIncome > 0) {
    warnings.push({ code: 'renda_conjuge_somada', message: 'A renda do cônjuge foi somada à renda do cliente.' })
  }

  return {
    totalIncome: round2(income),
    installment,
    financing,
    referenceValue,
    maxPurchaseValue,
    coverage,
    downPayment: {
      total: downTotal,
      fgts: round2(fgts),
      ownResources: round2(ownResources),
      subsidy: round2(subsidy),
      covered: round2(Math.min(coverage, downTotal)),
      remaining,
      surplus,
    },
    warnings,
  }
}

export function nearLimit(maxPurchaseValue: number, nearMarginPct: number) {
  return round2(maxPurchaseValue * (1 + nearMarginPct / 100))
}

// Para um imóvel de preço P: financia até financingPct% de P (sem passar do financiamento possível)
export function classifyProperty(
  price: number,
  result: Pick<SimulationResult, 'financing' | 'maxPurchaseValue' | 'coverage'>,
  params: Pick<SimulationParams, 'financingPct'> & { nearMarginPct: number },
): { fit: PropertyFit | null; downNeeded: number; downRemaining: number } {
  const financingUsed = Math.min(result.financing, (params.financingPct / 100) * price)
  const downNeeded = round2(price - financingUsed)
  const downRemaining = round2(Math.max(0, downNeeded - result.coverage))

  let fit: PropertyFit | null = null
  if (price <= result.maxPurchaseValue) fit = 'cabe'
  else if (price <= nearLimit(result.maxPurchaseValue, params.nearMarginPct)) fit = 'quase'

  return { fit, downNeeded, downRemaining }
}

export function isIncomeMatch(income: number, minIncome: number | null, maxIncome: number | null) {
  return minIncome !== null && maxIncome !== null && income >= minIncome && income <= maxIncome
}
