import { Prisma } from '@prisma/client'

/**
 * Só dígitos, sem o DDI 55 (quando sobram 12 ou 13 dígitos). Aceita 10 (fixo) ou 11 (celular)
 * dígitos com DDD; qualquer outra coisa devolve null
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = phoneDigits(raw)
  return digits.length === 10 || digits.length === 11 ? digits : null
}

/** Só dígitos, sem o DDI 55 quando sobram 12 ou 13 dígitos. Não confere o tamanho */
export function phoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits.slice(2)
  return digits
}

// ---------- Comparação ignorando a máscara (duplicidade e busca) ----------

const CANDIDATE_TAIL = 8
// Separadores que a máscara põe entre dígitos: 9XXXX-XXXX, "19 99546 1826" e "(19) 99546"
const MASK_SEPARATORS = ['-', ' ', ') ']

/**
 * Filtro de candidatos no banco: os últimos (até) 8 dígitos, puros ou com um separador da máscara em
 * qualquer posição, em phone ou phone2. É só um pré-filtro: a confirmação é em memória
 */
export function phoneCandidateWhere(digits: string): Prisma.LeadWhereInput {
  const tail = digits.slice(-CANDIDATE_TAIL)
  const fragments = new Set([tail])
  for (let index = 1; index < tail.length; index++) {
    for (const separator of MASK_SEPARATORS) fragments.add(`${tail.slice(0, index)}${separator}${tail.slice(index)}`)
  }
  return {
    OR: [...fragments].flatMap((fragment) => [{ phone: { contains: fragment } }, { phone2: { contains: fragment } }]),
  }
}

/** Telefone salvo (com ou sem máscara, com ou sem +55) contém esses dígitos */
export function phoneContainsDigits(stored: string | null | undefined, digits: string) {
  return digits.length > 0 && phoneDigits(stored).includes(digits)
}

export const MIN_PHONE_SEARCH_DIGITS = 4
const PHONE_LIKE = /^[\d\s()+\-.]+$/

/**
 * Dígitos para buscar por telefone, ou null: só quando o texto parece telefone (dígitos, parênteses, espaços,
 * traços, ponto e +) e tem pelo menos 4 dígitos. "+55 19 99546-1826" vira "19995461826"
 */
export function phoneSearchDigits(text: string | null | undefined): string | null {
  const value = (text ?? '').trim()
  if (!PHONE_LIKE.test(value)) return null
  const digits = phoneDigits(value)
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null
}

/** (DD) 9XXXX-XXXX para celular, (DD) XXXX-XXXX para fixo. Espera dígitos já normalizados */
export function formatPhone(digits: string) {
  const ddd = digits.slice(0, 2)
  const rest = digits.slice(2)
  const split = rest.length === 9 ? 5 : 4
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
}

type PhoneLookupDb = { lead: Pick<Prisma.TransactionClient['lead'], 'findMany'> }

export type PhoneMatch = { id: string; name: string; status: string; ownerId: string | null; phone: string }

/**
 * Lead ativo da organização com esse telefone em phone ou phone2, ignorando máscara.
 * Busca candidatos pelos últimos 8 dígitos (phoneCandidateWhere) e confere em memória pelos dígitos completos
 */
export async function findLeadByPhone(db: PhoneLookupDb, organizationId: string, digits: string): Promise<PhoneMatch | null> {
  const target = normalizePhone(digits)
  if (!target) return null

  const candidates = await db.lead.findMany({
    where: { organizationId, active: true, ...phoneCandidateWhere(target) },
    select: { id: true, name: true, status: true, ownerId: true, phone: true, phone2: true },
    take: 50,
  })

  const match = candidates.find(
    (lead) => normalizePhone(lead.phone) === target || normalizePhone(lead.phone2) === target,
  )
  if (!match) return null
  return { id: match.id, name: match.name, status: match.status, ownerId: match.ownerId, phone: match.phone }
}
