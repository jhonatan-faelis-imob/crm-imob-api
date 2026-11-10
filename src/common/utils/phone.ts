import { Prisma } from '@prisma/client'

/**
 * Só dígitos, sem o DDI 55 (quando sobram 12 ou 13 dígitos). Aceita 10 (fixo) ou 11 (celular)
 * dígitos com DDD; qualquer outra coisa devolve null
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2)
  return digits.length === 10 || digits.length === 11 ? digits : null
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
 * Busca candidatos pelos últimos 8 dígitos (como estão, ou com o hífen da máscara no meio)
 * e confere em memória pelos dígitos completos
 */
export async function findLeadByPhone(db: PhoneLookupDb, organizationId: string, digits: string): Promise<PhoneMatch | null> {
  const target = normalizePhone(digits)
  if (!target) return null

  const last8 = target.slice(-8)
  const fragments = [last8, `${last8.slice(0, 4)}-${last8.slice(4)}`, `${last8.slice(0, 4)} ${last8.slice(4)}`]
  const candidates = await db.lead.findMany({
    where: {
      organizationId,
      active: true,
      OR: fragments.flatMap((fragment) => [{ phone: { contains: fragment } }, { phone2: { contains: fragment } }]),
    },
    select: { id: true, name: true, status: true, ownerId: true, phone: true, phone2: true },
    take: 50,
  })

  const match = candidates.find(
    (lead) => normalizePhone(lead.phone) === target || normalizePhone(lead.phone2) === target,
  )
  if (!match) return null
  return { id: match.id, name: match.name, status: match.status, ownerId: match.ownerId, phone: match.phone }
}
