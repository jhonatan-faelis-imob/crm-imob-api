import { Prisma } from '@prisma/client'

// Payload gravado em IntegrationEvent: sem chaves, tokens ou senhas, cortado em 8 KB

export const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024

const SECRET_KEY = /(google_key|token|secret|password|senha|api_?key|authorization|access_key|signature)/i

function strip(value: unknown, depth: number): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth > 8) return '[…]'
  if (Array.isArray(value)) return value.map((item) => strip(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, Prisma.InputJsonValue | null> = {}
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue
      result[key] = strip(child, depth + 1)
    }
    return result
  }
  return typeof value === 'bigint' ? value.toString() : null
}

export function sanitizePayload(value: unknown): Prisma.InputJsonValue {
  const stripped = strip(value, 0) ?? {}
  const json = JSON.stringify(stripped)
  if (Buffer.byteLength(json, 'utf8') <= MAX_EVENT_PAYLOAD_BYTES) return stripped
  // Corta por bytes, sem quebrar um caractere no meio
  const preview = Buffer.from(json, 'utf8').subarray(0, MAX_EVENT_PAYLOAD_BYTES - 200).toString('utf8').replace(/�$/, '')
  return { truncated: true, preview }
}
