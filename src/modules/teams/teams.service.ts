import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateTeamDto } from './dto/create-team.dto'

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: { ...dto, organizationId },
      include: { coordinator: { select: { id: true, name: true, role: true } } },
    })
  }

  async findAll(organizationId: string) {
    return this.prisma.team.findMany({
      where: { organizationId, active: true },
      include: {
        coordinator: { select: { id: true, name: true, avatarUrl: true } },
        members: { select: { id: true, name: true, role: true, avatarUrl: true } },
        _count: { select: { members: true, leads: true } },
      },
      orderBy: { name: 'asc' },
    })
  }

  async findById(organizationId: string, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId },
      include: {
        coordinator: { select: { id: true, name: true, avatarUrl: true, role: true } },
        members: {
          select: { id: true, name: true, role: true, avatarUrl: true, creci: true, active: true },
        },
      },
    })
    if (!team) throw new NotFoundException('Equipe não encontrada')
    return team
  }

  async update(organizationId: string, id: string, dto: Partial<CreateTeamDto>) {
    await this.findById(organizationId, id)
    return this.prisma.team.update({ where: { id }, data: dto })
  }

  async deactivate(organizationId: string, id: string) {
    await this.findById(organizationId, id)
    return this.prisma.team.update({ where: { id }, data: { active: false } })
  }
}
