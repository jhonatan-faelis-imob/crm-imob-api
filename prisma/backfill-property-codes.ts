import { PrismaClient } from '@prisma/client'
import { planCodeBackfill } from '../src/modules/properties/property-code'

// Dá código aos imóveis que ainda não têm (00001, 00002...), por organização, a partir de propertyCodeSeq + 1.
// Simulação por padrão: só grava com --apply. Pode rodar mais de uma vez: só toca em quem está sem código.

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

function databaseHost() {
  const url = process.env.DATABASE_URL
  return url ? new URL(url).hostname : 'DATABASE_URL não definida'
}

async function backfillPropertyCodes() {
  console.log(`Banco: ${databaseHost()}`)
  console.log(apply ? 'Modo: gravação (--apply)\n' : 'Modo: simulação (nada será gravado; use --apply para gravar)\n')

  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  let total = 0
  const rows: { Organização: string; Título: string; 'Código novo': string }[] = []

  for (const organization of organizations) {
    // Uma transação por organização: lê, planeja e grava junto
    const assigned = await prisma.$transaction(
      async (tx) => {
        const { propertyCodeSeq } = await tx.organization.findUniqueOrThrow({
          where: { id: organization.id },
          select: { propertyCodeSeq: true },
        })
        const withoutCode = await tx.property.findMany({
          where: { organizationId: organization.id, code: null },
          select: { id: true, title: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
        if (withoutCode.length === 0) return []

        const taken = await tx.property.findMany({
          where: { organizationId: organization.id, code: { not: null } },
          select: { code: true },
        })
        const plan = planCodeBackfill(
          withoutCode,
          propertyCodeSeq,
          taken.map((item) => item.code).filter((code): code is string => code !== null),
        )

        if (apply) {
          for (const { id, code } of plan.assignments) {
            await tx.property.update({ where: { id }, data: { code } })
          }
          await tx.organization.update({ where: { id: organization.id }, data: { propertyCodeSeq: plan.sequence } })
        }

        const titles = new Map(withoutCode.map((item) => [item.id, item.title]))
        return plan.assignments.map(({ id, code }) => ({ title: titles.get(id) ?? id, code }))
      },
      { timeout: 60_000 },
    )

    total += assigned.length
    for (const item of assigned) rows.push({ Organização: organization.name, Título: item.title, 'Código novo': item.code })
  }

  if (rows.length > 0) console.table(rows)
  console.log(
    apply
      ? `\n${total} imóveis receberam código em ${organizations.length} organizações.`
      : `\n${total} imóveis receberiam código em ${organizations.length} organizações. Nada foi gravado.`,
  )
}

backfillPropertyCodes()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
