import { BadRequestException } from '@nestjs/common'

// Código do imóvel: automático (00001, 00002...) ou digitado (CS-01, AP-01), único por organização.
// Funções puras: sem Nest (só a exceção) e sem Prisma.

export const PROPERTY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,19}$/
export const PROPERTY_CODE_MESSAGE = 'Use letras, números e - _ . / (até 20 caracteres, sem espaços)'
/** Tentativas de achar um número livre quando alguém digitou à mão o próximo da sequência */
export const MAX_CODE_ATTEMPTS = 50

/** trim + maiúsculas. Vazio = sem código (null). Formato inválido = 400 */
export function normalizePropertyCode(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase()
  if (value === '') return null
  if (!PROPERTY_CODE_PATTERN.test(value)) throw new BadRequestException(PROPERTY_CODE_MESSAGE)
  return value
}

/** 1 → 00001. Acima de 99999 o padStart só deixa de preencher (100000) */
export function formatPropertyCode(sequence: number) {
  return String(sequence).padStart(5, '0')
}

export function duplicateCodeMessage(code: string, title: string) {
  return `Código "${code}" já está em uso pelo imóvel "${title}"`
}

/**
 * Plano do preenchimento: numera os imóveis sem código (já ordenados por createdAt e id) a partir de
 * sequence + 1, pulando códigos ocupados. Idempotente: quem já tem código nunca entra aqui.
 */
export function planCodeBackfill(
  propertiesWithoutCode: { id: string }[],
  sequence: number,
  takenCodes: Iterable<string>,
): { assignments: { id: string; code: string }[]; sequence: number } {
  const taken = new Set(takenCodes)
  let current = sequence
  const assignments = propertiesWithoutCode.map((property) => {
    let code: string
    do {
      current += 1
      code = formatPropertyCode(current)
    } while (taken.has(code))
    taken.add(code)
    return { id: property.id, code }
  })
  return { assignments, sequence: current }
}
