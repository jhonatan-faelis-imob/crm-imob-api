import { BadRequestException } from '@nestjs/common'

// Catálogo de planos: fonte única. O front lê pelo GET /billing/plans e o painel /admin usa nos formulários.
// Regra de produto: os planos diferem SÓ na quantidade de usuários; nenhuma funcionalidade é travada por plano.
// Corretor é fixo em 1 usuário (sem adicionais). Equipe e Imobiliária aceitam adicionais a R$ 30. Só ciclo mensal.

export const PLANS = [
  { id: 'corretor', name: 'Corretor', price: 89.9, seats: 1, extraSeatPrice: null, maxSeats: 1 },
  { id: 'equipe', name: 'Equipe', price: 247, seats: 5, extraSeatPrice: 30, maxSeats: null },
  { id: 'imobiliaria', name: 'Imobiliária', price: 699, seats: 20, extraSeatPrice: 30, maxSeats: null },
] as const satisfies readonly Plan[]

export interface Plan {
  id: string
  name: string
  price: number
  /** Usuários incluídos no preço base */
  seats: number
  /** null: o plano não vende usuário adicional */
  extraSeatPrice: number | null
  /** null: sem limite */
  maxSeats: number | null
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

/** Quantidade de usuários fora da regra do plano (Corretor com mais de 1) */
export class PlanSeatsError extends BadRequestException {}

export function findPlan(planId: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === planId)
}

export function planName(planId: string): string {
  return findPlan(planId)?.name ?? planId
}

export function defaultSeatsFor(planId: string): number {
  return findPlan(planId)?.seats ?? UNKNOWN_PLAN_SEATS
}

/** 400 se o plano não aceita essa quantidade de usuários (Corretor: só 1) */
export function assertPlanSeats(planId: string, seats: number) {
  const plan = findPlan(planId)
  if (plan?.maxSeats !== null && plan?.maxSeats !== undefined && seats > plan.maxSeats) {
    throw new PlanSeatsError(
      `O plano ${plan.name} é para ${plan.maxSeats === 1 ? '1 usuário' : `até ${plan.maxSeats} usuários`}. Escolha o Equipe ou o Imobiliária para mais usuários.`,
    )
  }
}

/**
 * Preço de tabela: base mais extraSeatPrice por assento acima do incluído.
 * Lança PlanSeatsError (400) se o plano não aceita essa quantidade (Corretor com mais de 1).
 * Plano desconhecido devolve null
 */
export function priceFor(planId: string, seats: number): number | null {
  const plan = findPlan(planId)
  if (!plan) return null
  assertPlanSeats(planId, seats)
  const extra = Math.max(0, seats - plan.seats)
  const total = plan.price + (plan.extraSeatPrice ?? 0) * extra
  return Math.round(total * 100) / 100
}

/** priceFor que não lança: para telas de consulta com dados antigos fora da regra */
export function safePriceFor(planId: string, seats: number): number | null {
  try {
    return priceFor(planId, seats)
  } catch {
    return null
  }
}
