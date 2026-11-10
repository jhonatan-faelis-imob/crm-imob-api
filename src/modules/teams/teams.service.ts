import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { canManageUser, forbiddenRoleMessage, type Actor } from '../users/user-permissions'
import { CreateTeamDto } from './dto/create-team.dto'
import { TeamMembersDto } from './dto/team-members.dto'
import { UpdateTeamDto } from './dto/update-team.dto'
import { setTeamKeepingSessions, validateCoordinator } from './team-rules'

const TEAM_DETAIL_INCLUDE = {
  coordinator: { select: { id: true, name: true, avatarUrl: true, role: true } },
  members: {
    select: { id: true, name: true, role: true, avatarUrl: true, creci: true, active: true },
    orderBy: { name: 'asc' as const },
  },
}

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async create(actor: Actor, dto: CreateTeamDto) {
    const coordinatorId = dto.coordinatorId ?? null
    return this.prisma.$transaction(async (tx) => {
      if (coordinatorId) await validateCoordinator(tx, actor, coordinatorId)
      const team = await tx.team.create({
        data: { name: dto.name, coordinatorId, organizationId: actor.organizationId },
      })
      // O coordenador passa a ser membro da equipe que coordena
      if (coordinatorId) await setTeamKeepingSessions(tx, { id: coordinatorId }, team.id)
      return tx.team.findUniqueOrThrow({ where: { id: team.id }, include: TEAM_DETAIL_INCLUDE })
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
    const team = await this.prisma.team.findFirst({ where: { id, organizationId }, include: TEAM_DETAIL_INCLUDE })
    if (!team) throw new NotFoundException('Equipe não encontrada')
    return team
  }

  async update(actor: Actor, id: string, dto: UpdateTeamDto) {
    await this.findById(actor.organizationId, id)
    if (dto.name === undefined && dto.coordinatorId === undefined) throw new BadRequestException('Nada para atualizar')

    return this.prisma.$transaction(async (tx) => {
      if (dto.coordinatorId) await validateCoordinator(tx, actor, dto.coordinatorId, id)
      await tx.team.update({ where: { id }, data: { name: dto.name, coordinatorId: dto.coordinatorId } })
      // Definir o coordenador também o coloca na equipe. Remover (null) não mexe no teamId dele
      if (dto.coordinatorId) await setTeamKeepingSessions(tx, { id: dto.coordinatorId }, id)
      return tx.team.findUniqueOrThrow({ where: { id }, include: TEAM_DETAIL_INCLUDE })
    })
  }

  /** Adiciona e remove membros numa transação só */
  async updateMembers(actor: Actor, id: string, dto: TeamMembersDto) {
    const team = await this.findById(actor.organizationId, id)
    if (!team.active) throw new BadRequestException('Equipe desativada')
    if (actor.role === 'coordenador' && actor.teamId !== id) {
      throw new ForbiddenException('Coordenador só gerencia os membros da própria equipe')
    }

    const addIds = [...new Set(dto.addUserIds ?? [])]
    const removeIds = [...new Set(dto.removeUserIds ?? [])]
    if (addIds.length === 0 && removeIds.length === 0) throw new BadRequestException('Nada para atualizar')
    if (addIds.some((userId) => removeIds.includes(userId))) {
      throw new BadRequestException('A mesma pessoa não pode ser adicionada e removida ao mesmo tempo')
    }

    return this.prisma.$transaction(async (tx) => {
      const ids = [...addIds, ...removeIds]
      const users = await tx.user.findMany({
        where: { id: { in: ids }, organizationId: actor.organizationId },
        select: { id: true, name: true, role: true, teamId: true },
      })
      if (users.length !== ids.length) throw new BadRequestException('Usuário não encontrado nesta organização')
      for (const user of users) {
        if (!canManageUser(actor.role, user.role)) {
          throw new ForbiddenException(`${forbiddenRoleMessage(user.role)} (${user.name})`)
        }
      }

      const byId = new Map(users.map((user) => [user.id, user]))
      for (const userId of removeIds) {
        if (userId === team.coordinatorId) {
          throw new ConflictException(
            `${byId.get(userId)?.name} é o coordenador desta equipe. Troque ou remova o coordenador antes de tirá-lo da equipe.`,
          )
        }
      }

      if (addIds.length > 0) {
        const coordinating = await tx.team.findFirst({
          where: { coordinatorId: { in: addIds }, active: true, id: { not: id } },
          select: { name: true, coordinatorId: true },
        })
        if (coordinating) {
          throw new ConflictException(
            `${byId.get(coordinating.coordinatorId ?? '')?.name} coordena a equipe "${coordinating.name}". Troque o coordenador de lá antes.`,
          )
        }
        if (actor.role === 'coordenador') {
          const fromOtherTeam = addIds.map((userId) => byId.get(userId)).find((user) => user?.teamId && user.teamId !== id)
          if (fromOtherTeam) throw new ForbiddenException(`${fromOtherTeam.name} está em outra equipe`)
        }
        await setTeamKeepingSessions(tx, { id: { in: addIds } }, id)
      }
      // Só tira quem está nesta equipe
      if (removeIds.length > 0) {
        await setTeamKeepingSessions(tx, { id: { in: removeIds }, teamId: id }, null)
      }
      return tx.team.findUniqueOrThrow({ where: { id }, include: TEAM_DETAIL_INCLUDE })
      // Até 200 pessoas, uma atualização por pessoa (ver setTeamKeepingSessions)
    }, { timeout: 20_000 })
  }

  async deactivate(organizationId: string, id: string) {
    await this.findById(organizationId, id)
    return this.prisma.team.update({ where: { id }, data: { active: false } })
  }
}
