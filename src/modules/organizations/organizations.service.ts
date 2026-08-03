import { Injectable, ConflictException, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateOrganizationDto) {
    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    })
    if (existing) throw new ConflictException('Slug já em uso')

    const org = await this.prisma.organization.create({ data: dto })

    // Seed das etapas padrão do funil
    await this.seedFunnelStages(org.id)

    return org
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, leads: true } },
      },
    })
    if (!org) throw new NotFoundException('Organização não encontrada')
    return org
  }

  async update(id: string, data: Partial<CreateOrganizationDto>) {
    return this.prisma.organization.update({ where: { id }, data })
  }

  async onboarding(dto: {
    orgName: string
    slug: string
    name: string
    email: string
    phone?: string
    password: string
  }) {
    // Verificar se slug já existe
    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    })
    if (existing) throw new ConflictException('Slug já em uso — tente outro nome')

    // Criar organização
    const org = await this.prisma.organization.create({
      data: { name: dto.orgName, slug: dto.slug, plan: 'free' },
    })

    // Seed das etapas padrão do funil
    await this.seedFunnelStages(org.id)

    // Criar usuário diretor
    const passwordHash = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: 'diretor',
      },
    })

    return { organization: org, user: { id: user.id, name: user.name, email: user.email } }
  }

  private async seedFunnelStages(organizationId: string) {
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
    await this.prisma.funnelStage.createMany({
      data: stages.map(s => ({ ...s, organizationId, isDefault: true })),
    })
  }
}
