import { PrismaClient } from '@prisma/client'
import { computeGoalProgress } from '../src/modules/goals/goal-progress'

const prisma = new PrismaClient()
const isDryRun = process.argv.includes('--dry-run')

function databaseHost() {
  const url = process.env.DATABASE_URL
  return url ? new URL(url).hostname : 'DATABASE_URL não definida'
}

async function recalculateGoals() {
  console.log(`Banco: ${databaseHost()}`)
  console.log(isDryRun ? 'Modo: dry-run (nada será gravado)\n' : 'Modo: gravação\n')

  const goals = await prisma.goal.findMany({
    where: { active: true },
    orderBy: { periodStart: 'desc' },
  })

  const results = await Promise.all(
    goals.map(async (goal) => {
      const progress = await computeGoalProgress(prisma, goal)
      const oldVgv = Number(goal.currentVgv)
      const newVgv = Number(progress.currentVgv)
      return {
        goal,
        progress,
        oldVgv,
        newVgv,
        changed: oldVgv !== newVgv || goal.currentUnits !== progress.currentUnits,
      }
    }),
  )

  console.table(
    results.map(({ goal, progress, oldVgv, newVgv, changed }) => ({
      Título: goal.title,
      'VGV antigo': oldVgv,
      'VGV novo': newVgv,
      'Unidades antigas': goal.currentUnits,
      'Unidades novas': progress.currentUnits,
      Mudou: changed ? 'sim' : 'não',
    })),
  )

  const changedResults = results.filter((result) => result.changed)

  if (isDryRun) {
    console.log(`\n${changedResults.length} de ${goals.length} metas seriam atualizadas.`)
    return
  }

  for (const { goal, progress } of changedResults) {
    await prisma.goal.update({ where: { id: goal.id }, data: progress })
  }

  console.log(`\n${changedResults.length} de ${goals.length} metas atualizadas.`)
}

recalculateGoals()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
