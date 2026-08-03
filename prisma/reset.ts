import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function reset() {
  console.log('🗑️  Limpando banco...')

  // Deletar na ordem correta (respeitar foreign keys)
  await prisma.saleStatusHistory.deleteMany()
  await prisma.goalDailyEntry.deleteMany()
  await prisma.dailyActivity.deleteMany()
  await prisma.leadTagRelation.deleteMany()
  await prisma.leadProperty.deleteMany()
  await prisma.document.deleteMany()
  await prisma.interaction.deleteMany()
  await prisma.task.deleteMany()
  await prisma.sale.deleteMany()
  await prisma.goal.deleteMany()
  await prisma.lead.deleteMany()
  await prisma.property.deleteMany()
  await prisma.leadTag.deleteMany()
  await prisma.messageTemplate.deleteMany()
  await prisma.funnelStage.deleteMany()
  await prisma.user.deleteMany()
  await prisma.team.deleteMany()
  await prisma.organization.deleteMany()

  console.log('✅ Banco limpo!')
}

reset()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
