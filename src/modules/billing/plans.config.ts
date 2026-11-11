// Catálogo de planos: fonte única. O front lê pelo GET /billing/plans e o painel /admin usa nos formulários

export const PLANS = [
  { id: 'corretor', name: 'Corretor', price: 89.9, seats: 1, extraSeatPrice: null },
  { id: 'equipe', name: 'Equipe', price: 247, seats: 5, extraSeatPrice: 30 },
  { id: 'imobiliaria', name: 'Imobiliária', price: 699, seats: 20, extraSeatPrice: 30 },
] as const satisfies readonly Plan[]

export interface Plan {
  id: string
  name: string
  price: number
  seats: number
  /** null: o plano não vende assento extra */
  extraSeatPrice: number | null
}

export type PlanId = (typeof PLANS)[number]['id']

export const PLAN_IDS = PLANS.map((plan) => plan.id)

export const TRIAL_DAYS = 14
/** Dias em "atrasada" antes de bloquear */
export const GRACE_DAYS = 5
/** Assentos quando o plano gravado não está no catálogo (planos antigos free/starter/pro) */
export const UNKNOWN_PLAN_SEATS = 20

export const SUBSCRIPTION_STATUSES = ['teste', 'ativa', 'atrasada', 'bloqueada', 'cancelada'] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export function findPlan(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId)
}

export function planName(planId: string): string {
  return findPlan(planId)?.name ?? planId
}

export function defaultSeatsFor(planId: string): number {
  return findPlan(planId)?.seats ?? UNKNOWN_PLAN_SEATS
}

/**
 * Preço de tabela: base mais extraSeatPrice por assento acima do incluído.
 * Plano sem assento extra (Corretor) cobra só a base; plano desconhecido devolve null
 */
export function priceFor(planId: string, seats: number): number | null {
  const plan = findPlan(planId)
  if (!plan) return null
  const extra = Math.max(0, seats - plan.seats)
  const total = plan.price + (plan.extraSeatPrice ?? 0) * extra
  return Math.round(total * 100) / 100
}
