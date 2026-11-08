export const SIMULATION_DEFAULTS = {
  commitmentPct: 30, // % da renda comprometida com a parcela
  termFactor: 108, // financiamento = parcela x fator
  financingPct: 80, // % máxima do imóvel que pode ser financiada
  nearMarginPct: 15, // tolerância acima do limite para "quase cabe"
}

export const SIMULATION_LIMITS = {
  commitmentPct: { min: 10, max: 50 },
  termFactor: { min: 24, max: 240 },
  financingPct: { min: 30, max: 95 },
  maxIncome: 1_000_000,
}

export const MAX_PROPERTIES = 12

// Fora da lista: esgotado/suspenso (empreendimento) e vendido (revenda)
export const UNAVAILABLE_PROPERTY_STATUSES = ['esgotado', 'suspenso', 'vendido']
