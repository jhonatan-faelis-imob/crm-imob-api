import { PrismaClient } from '@prisma/client'
import { defaultSeatsFor, findPlan, UNKNOWN_PLAN_SEATS } from '../src/modules/billing/plans.config'

// Retrocompatibilidade das assinaturas (rodar depois da migration 20261111090000_assinaturas).
// Para cada organização: situação "ativa", assentos conforme o plano atual (20 se o plano não está no catálogo,
// como os antigos free/starter/pro) e vencimento 30 dias à frente. Plano e valor não mudam.
// Simulação por padrão: só grava com --apply. Mostra a tabela antes.

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')
const DAY_MS = 24 * 60 * 60 * 1000

function databaseHost() {
  const url = process.env.DATABASE_URL
  return url ? new URL(url).hostname : 'DATABASE_URL não definida'
}

function day(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : '—'
}

async function backfillSubscriptions() {
  console.log(`Banco: ${databaseHost()}`)
  console.log(apply ? 'Modo: gravação (--apply)\n' : 'Modo: simulação (nada será gravado; use --apply para gravar)\n')

  const organizations = await prisma.organization.findMany({
    select: {
      id: true, name: true, plan: true, seats: true, subscriptionStatus: true, currentPeriodEnd: true,
      _count: { select: { users: { where: { active: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const currentPeriodEnd = new Date(Date.now() + 30 * DAY_MS)

  const plan = organizations.map((organization) => {
    const seats = defaultSeatsFor(organization.plan)
    return { organization, seats }
  })

  console.table(
    plan.map(({ organization, seats }) => ({
      Organização: organization.name,
      Plano: organization.plan + (findPlan(organization.plan) ? '' : ` (fora do catálogo: ${UNKNOWN_PLAN_SEATS} assentos)`),
      'Usuários ativos': organization._count.users,
      'Assentos: antes → depois': `${organization.seats} → ${seats}`,
      'Situação: antes → depois': `${organization.subscriptionStatus} → ativa`,
      'Vencimento: antes → depois': `${day(organization.currentPeriodEnd)} → ${day(currentPeriodEnd)}`,
      Aviso: organization._count.users > seats ? 'mais usuários ativos que assentos' : '',
    })),
  )

  if (!apply) {
    console.log(`\n${organizations.length} organizações seriam atualizadas. Nada foi gravado.`)
    return
  }

  for (const { organization, seats } of plan) {
    await prisma.$transaction([
      prisma.organization.update({
        where: { id: organization.id },
        data: { subscriptionStatus: 'ativa', seats, currentPeriodEnd },
      }),
      prisma.billingEvent.create({
        data: {
          organizationId: organization.id,
          kind: 'observacao',
          description: `Retrocompatibilidade: ativa, ${seats} assentos, vencimento ${day(currentPeriodEnd)}`,
          createdBy: 'script backfill-subscriptions',
        },
      }),
    ])
  }
  console.log(`\n${organizations.length} organizações atualizadas.`)
}

backfillSubscriptions()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
