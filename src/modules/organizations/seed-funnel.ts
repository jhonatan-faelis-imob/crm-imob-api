import type { Prisma } from '@prisma/client'

const DEFAULT_STAGES = [
  { name: 'Novo', color: '#94a3b8', orderIndex: 1 },
  { name: 'Contato', color: '#60a5fa', orderIndex: 2 },
  { name: 'Qualificação', color: '#a78bfa', orderIndex: 3 },
  { name: 'Simulação', color: '#f59e0b', orderIndex: 4 },
  { name: 'Agendamento', color: '#fb923c', orderIndex: 5 },
  { name: 'Negociação', color: '#f43f5e', orderIndex: 6 },
  { name: 'Ganho', color: '#22c55e', orderIndex: 7 },
  { name: 'Perdido', color: '#ef4444', orderIndex: 8 },
]

/** Etapas padrão do funil de uma organização nova (onboarding e painel /admin) */
export async function seedFunnelStages(db: Pick<Prisma.TransactionClient, 'funnelStage'>, organizationId: string) {
  await db.funnelStage.createMany({
    data: DEFAULT_STAGES.map((stage) => ({ ...stage, organizationId, isDefault: true })),
  })
}
