import { businessHour } from '../../common/utils/date'

const VARIABLE_PATTERN = /\{\{([^{}]+)\}\}/g

export function extractVariables(content: string): string[] {
  const names = Array.from(content.matchAll(VARIABLE_PATTERN), (match) => match[1].trim())
  return Array.from(new Set(names))
}

export function greeting(now = new Date()): string {
  const hour = businessHour(now)
  if (hour < 12) return 'Bom dia'
  return hour < 18 ? 'Boa tarde' : 'Boa noite'
}

// Passada única, com função: o nome de um lead não é reinterpretado como variável nem como
// padrão especial do replace ($&). Vazia ou desconhecida fica no texto para o front destacar.
export function renderTemplate(content: string, values: Record<string, string | null | undefined>) {
  const missing = new Set<string>()
  const text = content.replace(VARIABLE_PATTERN, (placeholder, rawName: string) => {
    const name = rawName.trim()
    const value = values[name]
    if (value) return value
    missing.add(name)
    return placeholder
  })
  return { text, missing: Array.from(missing) }
}

// Array.from corta por caractere: slice direto partiria um emoji ao meio
export function truncateText(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('')
}
