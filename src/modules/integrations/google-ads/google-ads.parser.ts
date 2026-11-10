import { createHash, timingSafeEqual } from 'crypto'

// Webhook de formulários de lead do Google Ads. Formato (developers.google.com/google-ads/webhook/docs/implementation):
// { lead_id, user_column_data: [{ column_id, column_name?, string_value }], form_id, campaign_id,
//   google_key, is_test?, api_version, gcl_id, ... }. column_id: FULL_NAME, FIRST_NAME, LAST_NAME, EMAIL,
//   PHONE_NUMBER (E.164) e outros; perguntas personalizadas vêm com o column_name da pergunta

export interface ParsedGoogleLead {
  leadId: string
  isTest: boolean
  name: string
  phone: string | null
  email: string | null
  /** "Pergunta: resposta" de todas as outras colunas */
  answers: string[]
  sourceDetail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** FULL_NAME -> "Full name"; usado quando a coluna não traz column_name */
function humanize(columnId: string) {
  const text = columnId.toLowerCase().replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function googleKeyOf(body: unknown): string | null {
  return isRecord(body) ? asText(body.google_key) : null
}

/** Comparação em tempo constante; o hash iguala os tamanhos antes do timingSafeEqual */
export function safeEqual(received: string, expected: string) {
  const a = createHash('sha256').update(received, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b) && received.length === expected.length
}

/** null = corpo fora do formato (sem lead_id ou sem user_column_data em lista) */
export function parseGoogleLead(body: unknown): ParsedGoogleLead | null {
  if (!isRecord(body)) return null
  const leadId = asText(body.lead_id)
  if (!leadId || !Array.isArray(body.user_column_data)) return null

  const values = new Map<string, string>()
  const answers: string[] = []
  for (const column of body.user_column_data) {
    if (!isRecord(column)) continue
    const columnId = asText(column.column_id)?.toUpperCase() ?? ''
    const value = asText(column.string_value)
    if (!value) continue
    if (['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'PHONE_NUMBER'].includes(columnId) && !values.has(columnId)) {
      values.set(columnId, value)
      continue
    }
    const label = asText(column.column_name) ?? (columnId ? humanize(columnId) : 'Pergunta')
    answers.push(`${label}: ${value}`)
  }

  const name =
    values.get('FULL_NAME') ??
    [values.get('FIRST_NAME'), values.get('LAST_NAME')].filter(Boolean).join(' ')

  const campaign = asText(body.campaign_id)
  const form = asText(body.form_id)
  const sourceDetail = ['Google Ads', campaign && `campanha ${campaign}`, form && `formulário ${form}`]
    .filter(Boolean)
    .join(' · ')

  return {
    leadId,
    isTest: body.is_test === true || body.is_test === 'true',
    name,
    phone: values.get('PHONE_NUMBER') ?? null,
    email: values.get('EMAIL') ?? null,
    answers,
    sourceDetail,
  }
}
