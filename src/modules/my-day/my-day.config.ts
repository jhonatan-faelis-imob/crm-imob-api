export const STALE_DAYS_DEFAULT = 3
export const STALE_DAYS_ADVANCED_STAGES = 2 // simulacao, agendamento, negociacao
export const STALE_DAYS_URGENT = 1 // urgency = imediato
export const FIRST_CONTACT_GRACE_MINUTES = 60
export const MAX_ITEMS = 100
export const DEFAULT_ITEMS = 40
export const MAX_LEADS = 500

export const ADVANCED_STAGES = ['simulacao', 'agendamento', 'negociacao']
export const CLOSED_STATUSES = ['ganho', 'perdido']

export const URGENCY_BONUS: Record<string, number> = { imediato: 20, um_mes: 10, tres_meses: 5 }
export const ADVANCED_STAGE_BONUS = 10

export const BAND_NOW_MIN_SCORE = 85
export const BAND_TODAY_MIN_SCORE = 60
