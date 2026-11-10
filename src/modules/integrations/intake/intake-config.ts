import { Prisma } from '@prisma/client'

// Configuração de entrada de leads de uma integração (Google Ads agora; portais e Meta depois)
export interface IntakeConfig {
  assignment: { userIds: string[] }
  createFirstContactTask: boolean
  firstContactMinutes: number
}

export const DEFAULT_FIRST_CONTACT_MINUTES = 15
export const MAX_FIRST_CONTACT_MINUTES = 24 * 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Lê o Json guardado com tolerância: campo ausente ou com tipo errado vira o padrão */
export function readIntakeConfig(config: Prisma.JsonValue | null | undefined): IntakeConfig {
  const raw = isRecord(config) ? config : {}
  const assignment = isRecord(raw.assignment) ? raw.assignment : {}
  const userIds = Array.isArray(assignment.userIds)
    ? assignment.userIds.filter((id): id is string => typeof id === 'string')
    : []
  const minutes = typeof raw.firstContactMinutes === 'number' ? Math.round(raw.firstContactMinutes) : DEFAULT_FIRST_CONTACT_MINUTES
  return {
    assignment: { userIds },
    createFirstContactTask: typeof raw.createFirstContactTask === 'boolean' ? raw.createFirstContactTask : true,
    firstContactMinutes: Math.min(Math.max(minutes, 1), MAX_FIRST_CONTACT_MINUTES),
  }
}
