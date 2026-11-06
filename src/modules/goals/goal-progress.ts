import type { Goal, Prisma, PrismaClient } from '@prisma/client'

// Compartilhado com prisma/recalculate-goals.ts, que precisa do valor antes de gravar
export async function computeGoalProgress(
  prisma: PrismaClient,
  goal: Goal,
): Promise<{ currentVgv: Prisma.Decimal | number; currentUnits: number }> {
  const sales = await prisma.sale.aggregate({
    where: {
      organizationId: goal.organizationId,
      status: { not: 'cancelado' },
      ...(goal.userId ? { brokerId: goal.userId } : {}),
      ...(goal.teamId ? { teamId: goal.teamId } : {}),
      soldAt: { gte: goal.periodStart, lte: goal.periodEnd },
    },
    _sum: { saleValue: true },
    _count: { id: true },
  })

  return { currentVgv: sales._sum.saleValue ?? 0, currentUnits: sales._count.id }
}
