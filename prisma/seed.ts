import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Criar organização
  const org = await prisma.organization.upsert({
    where: { slug: 'imobiliaria-demo' },
    update: {},
    create: {
      name: 'Imobiliária Demo',
      slug: 'imobiliaria-demo',
      plan: 'pro',
    },
  })

  // Criar usuário diretor
  const passwordHash = await bcrypt.hash('123456', 10)

  const diretor = await prisma.user.upsert({
    where: { email: 'diretor@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      name: 'João Diretor',
      email: 'diretor@demo.com',
      passwordHash,
      role: 'diretor',
    },
  })

  // Criar corretor
  await prisma.user.upsert({
    where: { email: 'corretor@demo.com' },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Maria Corretora',
      email: 'corretor@demo.com',
      passwordHash,
      role: 'corretor',
      creci: 'CRECI-SP 123456',
    },
  })

  // Criar etapas padrão do funil
  const stages = [
    { name: 'Novo', color: '#94a3b8', orderIndex: 1 },
    { name: 'Contato', color: '#60a5fa', orderIndex: 2 },
    { name: 'Qualificação', color: '#a78bfa', orderIndex: 3 },
    { name: 'Simulação', color: '#f59e0b', orderIndex: 4 },
    { name: 'Agendamento', color: '#fb923c', orderIndex: 5 },
    { name: 'Negociação', color: '#f43f5e', orderIndex: 6 },
    { name: 'Ganho', color: '#22c55e', orderIndex: 7 },
    { name: 'Perdido', color: '#ef4444', orderIndex: 8 },
  ]

  for (const stage of stages) {
    await prisma.funnelStage.upsert({
      where: { id: `${org.id}-${stage.orderIndex}` },
      update: {},
      create: {
        id: `${org.id}-${stage.orderIndex}`,
        organizationId: org.id,
        ...stage,
        isDefault: true,
      },
    })
  }

  console.log('✅ Seed concluído!')
  console.log(`📧 diretor@demo.com / 123456`)
  console.log(`📧 corretor@demo.com / 123456`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
