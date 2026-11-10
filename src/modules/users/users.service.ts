import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { assertTeamInOrganization, findCoordinatedTeam } from '../teams/team-rules'
import { CreateUserDto } from './dto/create-user.dto'
import { ListUsersQueryDto } from './dto/list-users.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { canCoordinate, canManageUser, forbiddenRoleMessage, type Actor } from './user-permissions'

const USER_SELECT = {
  id: true, name: true, email: true, role: true,
  phone: true, creci: true, avatarUrl: true,
  teamId: true, active: true, lastLogin: true, createdAt: true,
  team: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect

/** 16 caracteres de base64url (96 bits). Nunca vai para log */
export function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url')
}

function assertCanManage(actor: Actor, targetRole: string) {
  if (!canManageUser(actor.role, targetRole)) throw new ForbiddenException(forbiddenRoleMessage(targetRole))
}

/** Coordenador só coloca gente na própria equipe */
function assertTeamAllowedFor(actor: Actor, teamId: string | null | undefined) {
  if (actor.role === 'coordenador' && teamId && teamId !== actor.teamId) {
    throw new ForbiddenException('Coordenador só pode colocar pessoas na própria equipe')
  }
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  async create(actor: Actor, dto: CreateUserDto) {
    assertCanManage(actor, dto.role)
    assertTeamAllowedFor(actor, dto.teamId)
    if (dto.teamId) await assertTeamInOrganization(this.prisma, actor.organizationId, dto.teamId)

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email já cadastrado')

    const { password, teamId, ...rest } = dto
    const temporaryPassword = password ? undefined : generateTemporaryPassword()
    const passwordHash = await this.authService.hashPassword(password ?? temporaryPassword ?? '')

    const user = await this.prisma.user.create({
      data: { ...rest, teamId: teamId ?? null, passwordHash, organizationId: actor.organizationId },
      select: USER_SELECT,
    })
    // Única vez que a senha gerada sai do servidor
    return temporaryPassword ? { ...user, temporaryPassword } : user
  }

  async findAll(actor: Actor, query: ListUsersQueryDto = {}) {
    const where: Prisma.UserWhereInput = { organizationId: actor.organizationId }
    if (query.role) where.role = query.role

    if (actor.role === 'coordenador') {
      // Coordenador vê só a própria equipe; sem equipe, só a si mesmo. "Sem equipe" não é da equipe dele
      if (query.teamId === 'none') return []
      if (query.teamId && query.teamId !== actor.teamId) return []
      if (actor.teamId) where.teamId = actor.teamId
      else where.id = actor.id
    } else if (query.teamId) {
      where.teamId = query.teamId === 'none' ? null : query.teamId
    }

    return this.prisma.user.findMany({ where, select: USER_SELECT, orderBy: { name: 'asc' } })
  }

  async findById(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId }, select: USER_SELECT })
    if (!user) throw new NotFoundException('Usuário não encontrado')
    return user
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto) {
    const current = await this.findById(actor.organizationId, id)
    const changesStructure = dto.role !== undefined || dto.teamId !== undefined || dto.active !== undefined
    // Editar o próprio nome, telefone ou CRECI não depende de cargo
    if (id !== actor.id || changesStructure) {
      assertCanManage(actor, current.role)
      if (dto.role !== undefined) assertCanManage(actor, dto.role)
    }
    assertTeamAllowedFor(actor, dto.teamId)

    const teamChanges = dto.teamId !== undefined && dto.teamId !== current.teamId
    if (dto.teamId) await assertTeamInOrganization(this.prisma, actor.organizationId, dto.teamId)
    const coordinated = await findCoordinatedTeam(this.prisma, id)
    if (coordinated && teamChanges && dto.teamId !== coordinated.id) {
      throw new ConflictException(
        `${current.name} coordena a equipe "${coordinated.name}". Troque o coordenador antes de mudar a equipe.`,
      )
    }

    return this.prisma.$transaction(async (tx) => {
      // Rebaixado para um cargo que não coordena: a equipe fica sem coordenador
      if (dto.role !== undefined && !canCoordinate(dto.role)) {
        await tx.team.updateMany({ where: { coordinatorId: id }, data: { coordinatorId: null } })
      }
      return tx.user.update({ where: { id }, data: dto, select: USER_SELECT })
    })
  }

  async resetPassword(organizationId: string, id: string, newPassword: string) {
    await this.findById(organizationId, id)
    const passwordHash = await this.authService.hashPassword(newPassword)
    return this.prisma.user.update({ where: { id }, data: { passwordHash } })
  }
}
