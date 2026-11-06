import type { Goal, Prisma, PrismaClient } from '@prisma/client'
import { businessDayBounds } from '../../common/utils/date'

function percent(current: number, target: number) {
  return target > 0 ? Math.round((current / target) * 1000) / 10 : 0
}

function saleScope(goal: Goal): Prisma.SaleWhereInput {
  return {
    organizationId: goal.organizationId,
    status: { not: 'cancelado' },
    ...(goal.userId ? { brokerId: goal.userId } : {}),
    ...(goal.teamId ? { teamId: goal.teamId } : {}),
    soldAt: { gte: goal.periodStart, lte: goal.periodEnd },
  }
}

// Compartilhado com prisma/recalculate-goals.ts, que precisa do valor antes de gravar
export async function computeGoalProgress(
  prisma: PrismaClient,
  goal: Goal,
): Promise<{ currentVgv: Prisma.Decimal | number; currentUnits: number }> {
  const sales = await prisma.sale.aggregate({
    where: saleScope(goal),
    _sum: { saleValue: true },
    _count: { id: true },
  })

  return { currentVgv: sales._sum.saleValue ?? 0, currentUnits: sales._count.id }
}

// Leads e tarefas têm horário: o período vai do início do primeiro dia ao fim do último,
// em São Paulo. Metas antigas guardavam o alvo de qualquer tipo em targetVgv.
export async function computeTypedProgress(prisma: PrismaClient, goal: Goal) {
  const genericTarget = Number(goal.targetValue ?? goal.targetVgv ?? 0)
  const periodStart = businessDayBounds(goal.periodStart.toISOString().slice(0, 10)).start
  const periodEnd = businessDayBounds(goal.periodEnd.toISOString().slice(0, 10)).end

  let current: number
  let target = genericTarget

  switch (goal.type) {
    case 'unidades':
      current = await prisma.sale.count({ where: saleScope(goal) })
      target = Number(goal.targetValue ?? goal.goalUnits ?? goal.targetVgv ?? 0)
      break
    case 'leads':
      current = await prisma.lead.count({
        where: {
          organizationId: goal.organizationId,
          ...(goal.userId ? { ownerId: goal.userId } : {}),
          ...(goal.teamId ? { teamId: goal.teamId } : {}),
          createdAt: { gte: periodStart, lte: periodEnd },
        },
      })
      break
    case 'visitas':
      current = await prisma.task.count({
        where: {
          organizationId: goal.organizationId,
          type: 'visita',
          status: 'concluida',
          ...(goal.userId ? { assignedTo: goal.userId } : {}),
          ...(goal.teamId ? { assignee: { teamId: goal.teamId } } : {}),
          completedAt: { gte: periodStart, lte: periodEnd },
        },
      })
      break
    case 'contratos':
      current = await prisma.sale.count({
        where: { ...saleScope(goal), status: { in: ['contrato_assinado', 'concluido'] } },
      })
      break
    default: {
      const { currentVgv } = await computeGoalProgress(prisma, goal)
      current = Number(currentVgv)
      target = Number(goal.targetVgv ?? 0)
    }
  }

  return { current, target, percent: percent(current, target) }
}
