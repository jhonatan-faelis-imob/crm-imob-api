import { BadRequestException, Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizeEmail } from '../../common/utils/email'
import { AuthService } from '../auth/auth.service'
import { assertSeatAvailable } from '../billing/seat-limit'
import { assertTeamInOrganization, findCoordinatedTeam } from '../teams/team-rules'
import { CreateUserDto } from './dto/create-user.dto'
import { DeactivateUserDto } from './dto/deactivate-user.dto'
import { ListUsersQueryDto } from './dto/list-users.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { TransferPortfolioDto, type TransferKind } from './dto/transfer-portfolio.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import {
  canCoordinate, canManageUser, forbiddenRoleMessage, isCoordinatorOrAbove, isManagerOrAbove, type Actor,
} from './user-permissions'

const USER_SELECT = {
  id: true, name: true, email: true, role: true,
  phone: true, creci: true, avatarUrl: true,
  teamId: true, active: true, lastLogin: true, createdAt: true,
  deactivatedAt: true, deactivatedBy: true,
  team: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect

/** Listagem: o motivo da desativação só sai para quem pode ver inativos (coordenador ou superior) */
const LIST_SELECT = { ...USER_SELECT, deactivationReason: true } satisfies Prisma.UserSelect

/** Lead que ainda está na carteira: ativo e fora dos estados finais */
const OPEN_LEAD_WHERE = { active: true, status: { notIn: ['ganho', 'perdido'] } } satisfies Prisma.LeadWhereInput

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

/** Coordenador só gere gente da própria equipe (desativar, reativar, transferir) */
function assertInScope(actor: Actor, target: { teamId: string | null }) {
  if (actor.role === 'coordenador' && (!actor.teamId || target.teamId !== actor.teamId)) {
    throw new ForbiddenException('Coordenador só gerencia pessoas da própria equipe')
  }
}

export interface PortfolioSummary {
  leadsAtivos: number
  tarefasPendentes: number
  imoveis: number
  metasAtivas: number
}

export interface DeleteBlocker {
  kind: string
  label: string
  count: number
}

type PortfolioDb = Pick<Prisma.TransactionClient, 'lead' | 'task' | 'property' | 'goal'>

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

    const email = normalizeEmail(dto.email)
    // insensitive: conta antiga gravada com maiúsculas também conta como duplicada
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
    if (existing) throw new ConflictException('Email já cadastrado')

    // Assentos do plano: conta os ativos da organização (402 SEAT_LIMIT)
    await assertSeatAvailable(this.prisma, actor.organizationId)

    const { password, teamId, ...rest } = dto
    const temporaryPassword = password ? undefined : generateTemporaryPassword()
    const passwordHash = await this.authService.hashPassword(password ?? temporaryPassword ?? '')

    const user = await this.prisma.user.create({
      data: { ...rest, email, teamId: teamId ?? null, passwordHash, organizationId: actor.organizationId },
      select: USER_SELECT,
    })
    // Única vez que a senha gerada sai do servidor
    return temporaryPassword ? { ...user, temporaryPassword } : user
  }

  /** `active=true` (padrão), `false` ou `all`; os dois últimos só para coordenador ou superior */
  async findAll(actor: Actor, query: ListUsersQueryDto = {}) {
    const filter = query.active ?? 'true'
    if (filter !== 'true' && !isCoordinatorOrAbove(actor.role)) {
      throw new ForbiddenException('Seu cargo não permite ver usuários inativos')
    }
    const where: Prisma.UserWhereInput = { organizationId: actor.organizationId }
    if (filter !== 'all') where.active = filter === 'true'
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

    const users = await this.prisma.user.findMany({ where, select: LIST_SELECT, orderBy: { name: 'asc' } })
    // deactivatedBy não tem FK: resolve o nome de quem desativou numa consulta só
    const byIds = [...new Set(users.map((user) => user.deactivatedBy).filter((id): id is string => !!id))]
    const names = new Map<string, string>()
    if (byIds.length > 0) {
      const authors = await this.prisma.user.findMany({
        where: { id: { in: byIds }, organizationId: actor.organizationId },
        select: { id: true, name: true },
      })
      authors.forEach((author) => names.set(author.id, author.name))
    }
    return users.map((user) => ({
      ...user,
      deactivatedByName: user.deactivatedBy ? (names.get(user.deactivatedBy) ?? null) : null,
    }))
  }

  async findById(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, organizationId }, select: USER_SELECT })
    if (!user) throw new NotFoundException('Usuário não encontrado')
    return user
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto) {
    const current = await this.findById(actor.organizationId, id)
    const isSelf = id === actor.id
    const roleChanges = dto.role !== undefined && dto.role !== current.role
    // Ninguém se promove: o cargo de cada pessoa é mudado por outra
    if (isSelf && roleChanges) throw new ForbiddenException('Você não pode alterar o próprio cargo')

    const emailChanges = dto.email !== undefined && normalizeEmail(dto.email) !== current.email.toLowerCase()
    const changesStructure = roleChanges || dto.teamId !== undefined || emailChanges
    // Editar o próprio nome, telefone ou CRECI não depende de cargo
    if (!isSelf || changesStructure) {
      assertCanManage(actor, current.role)
      if (roleChanges && dto.role !== undefined) assertCanManage(actor, dto.role)
    }
    assertTeamAllowedFor(actor, dto.teamId)

    if (emailChanges && dto.email !== undefined) {
      if (!isManagerOrAbove(actor.role)) throw new ForbiddenException('Só gerente ou superior pode alterar o e-mail')
      const taken = await this.prisma.user.findFirst({
        where: { email: { equals: normalizeEmail(dto.email), mode: 'insensitive' }, id: { not: id } },
        select: { id: true },
      })
      if (taken) throw new ConflictException('Email já cadastrado')
    }

    const teamChanges = dto.teamId !== undefined && dto.teamId !== current.teamId
    if (dto.teamId) await assertTeamInOrganization(this.prisma, actor.organizationId, dto.teamId)
    const coordinated = await findCoordinatedTeam(this.prisma, id)
    if (coordinated && teamChanges && dto.teamId !== coordinated.id) {
      throw new ConflictException(
        `${current.name} coordena a equipe "${coordinated.name}". Troque o coordenador antes de mudar a equipe.`,
      )
    }

    const data: Prisma.UserUncheckedUpdateInput = { ...dto }
    if (dto.email !== undefined) data.email = normalizeEmail(dto.email)
    return this.prisma.$transaction(async (tx) => {
      // Rebaixado para um cargo que não coordena: a equipe fica sem coordenador
      if (dto.role !== undefined && !canCoordinate(dto.role)) {
        await tx.team.updateMany({ where: { coordinatorId: id }, data: { coordinatorId: null } })
      }
      return tx.user.update({ where: { id }, data, select: USER_SELECT })
    })
  }

  /** O que a pessoa tem hoje; o front mostra antes de desativar e oferece a transferência */
  async portfolio(actor: Actor, id: string): Promise<PortfolioSummary> {
    const target = await this.findById(actor.organizationId, id)
    assertCanManage(actor, target.role)
    assertInScope(actor, target)
    return this.portfolioOf(this.prisma, actor.organizationId, id)
  }

  private async portfolioOf(db: PortfolioDb, organizationId: string, userId: string): Promise<PortfolioSummary> {
    const [leadsAtivos, tarefasPendentes, imoveis, metasAtivas] = await Promise.all([
      db.lead.count({ where: { organizationId, ownerId: userId, ...OPEN_LEAD_WHERE } }),
      db.task.count({ where: { organizationId, assignedTo: userId, status: 'pendente' } }),
      db.property.count({ where: { organizationId, ownerId: userId, active: true } }),
      db.goal.count({ where: { organizationId, userId, active: true } }),
    ])
    return { leadsAtivos, tarefasPendentes, imoveis, metasAtivas }
  }

  /** Ao menos um diretor (ativo, se `activeOnly`) precisa sobrar na organização */
  private async assertNotLastDirector(organizationId: string, target: { id: string; role: string }, activeOnly: boolean) {
    if (target.role !== 'diretor') return
    const others = await this.prisma.user.count({
      where: { organizationId, role: 'diretor', id: { not: target.id }, ...(activeOnly ? { active: true } : {}) },
    })
    if (others === 0) throw new ConflictException('A imobiliária precisa de ao menos um diretor ativo')
  }

  /**
   * Desativa sem apagar nada: leads, tarefas, imóveis, metas e vendas continuam no nome da pessoa.
   * Grava active=false e o updatedAt muda, então a sessão cai na hora (JwtStrategy recusa inativo)
   */
  async deactivate(actor: Actor, id: string, dto: DeactivateUserDto) {
    if (id === actor.id) throw new ForbiddenException('Você não pode desativar a si mesmo')
    const target = await this.findById(actor.organizationId, id)
    assertCanManage(actor, target.role)
    assertInScope(actor, target)
    if (!target.active) throw new BadRequestException('Este usuário já está desativado')
    await this.assertNotLastDirector(actor.organizationId, target, true)
    const coordinated = await findCoordinatedTeam(this.prisma, id)
    if (coordinated) {
      throw new ConflictException(
        `${target.name} coordena a equipe "${coordinated.name}". Troque o coordenador antes de desativar.`,
      )
    }

    const reason = dto.reason?.trim() || null
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { active: false, deactivatedAt: new Date(), deactivatedBy: actor.id, deactivationReason: reason },
        select: USER_SELECT,
      })
      await tx.billingEvent.create({
        data: {
          organizationId: actor.organizationId,
          kind: 'usuario_desativado',
          createdBy: actor.email ?? actor.id,
          description: `Usuário ${target.name} desativado${reason ? `: ${reason}` : ''}`,
          data: { userId: id },
        },
      })
      const summary = await this.portfolioOf(tx, actor.organizationId, id)
      return { user, summary }
    })
  }

  /** Reativar ocupa um assento (402 SEAT_LIMIT se o plano estiver cheio) */
  async activate(actor: Actor, id: string) {
    const target = await this.findById(actor.organizationId, id)
    assertCanManage(actor, target.role)
    assertInScope(actor, target)
    if (target.active) throw new BadRequestException('Este usuário já está ativo')
    await assertSeatAvailable(this.prisma, actor.organizationId)
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { active: true, deactivatedAt: null, deactivatedBy: null, deactivationReason: null },
        select: USER_SELECT,
      })
      await tx.billingEvent.create({
        data: {
          organizationId: actor.organizationId,
          kind: 'usuario_reativado',
          createdBy: actor.email ?? actor.id,
          description: `Usuário ${target.name} reativado`,
          data: { userId: id },
        },
      })
      return user
    })
  }

  /**
   * Passa para outra pessoa os leads ativos, as tarefas pendentes e os imóveis.
   * Metas (individuais e históricas) e vendas já registradas ficam onde estão
   */
  async transfer(actor: Actor, id: string, dto: TransferPortfolioDto) {
    if (id === dto.toUserId) throw new BadRequestException('Escolha outra pessoa para receber a carteira')
    const from = await this.findById(actor.organizationId, id)
    const to = await this.findById(actor.organizationId, dto.toUserId)
    assertCanManage(actor, from.role)
    assertCanManage(actor, to.role)
    assertInScope(actor, from)
    assertInScope(actor, to)
    if (!to.active) throw new BadRequestException('Quem recebe a carteira precisa estar ativo')

    const wants = (kind: TransferKind) => dto.what.includes(kind)
    return this.prisma.$transaction(async (tx) => {
      const moved = { leads: 0, tasks: 0, properties: 0 }
      if (wants('leads')) {
        // O lead acompanha a equipe de quem recebe (a visibilidade do coordenador depende dela)
        const result = await tx.lead.updateMany({
          where: { organizationId: actor.organizationId, ownerId: id, ...OPEN_LEAD_WHERE },
          data: { ownerId: to.id, teamId: to.teamId },
        })
        moved.leads = result.count
      }
      if (wants('tasks')) {
        const result = await tx.task.updateMany({
          where: { organizationId: actor.organizationId, assignedTo: id, status: 'pendente' },
          data: { assignedTo: to.id },
        })
        moved.tasks = result.count
      }
      if (wants('properties')) {
        const result = await tx.property.updateMany({
          where: { organizationId: actor.organizationId, ownerId: id, active: true },
          data: { ownerId: to.id },
        })
        moved.properties = result.count
      }
      await tx.billingEvent.create({
        data: {
          organizationId: actor.organizationId,
          kind: 'carteira_transferida',
          createdBy: actor.email ?? actor.id,
          description: `Carteira de ${from.name} para ${to.name}: ${moved.leads} leads, ${moved.tasks} tarefas, ${moved.properties} imóveis`,
          data: { fromUserId: id, toUserId: to.id, what: dto.what, moved },
        },
      })
      return moved
    })
  }

  /** Tudo o que impede a exclusão definitiva de uma pessoa */
  async deleteBlockers(organizationId: string, userId: string): Promise<DeleteBlocker[]> {
    const db = this.prisma
    const [leads, tasks, properties, goals, goalEntries, sales, interactions, shares, activities, coordinated] =
      await Promise.all([
        db.lead.count({ where: { organizationId, ownerId: userId } }),
        db.task.count({ where: { organizationId, OR: [{ assignedTo: userId }, { createdBy: userId }] } }),
        db.property.count({ where: { organizationId, ownerId: userId } }),
        db.goal.count({ where: { organizationId, userId } }),
        db.goalDailyEntry.count({ where: { organizationId, userId } }),
        db.sale.count({ where: { organizationId, brokerId: userId } }),
        db.interaction.count({ where: { organizationId, userId } }),
        db.propertyShare.count({ where: { organizationId, createdBy: userId } }),
        db.dailyActivity.count({ where: { organizationId, userId } }),
        db.team.count({ where: { organizationId, coordinatorId: userId, active: true } }),
      ])
    const all: DeleteBlocker[] = [
      { kind: 'leads', label: 'leads', count: leads },
      { kind: 'tasks', label: 'tarefas', count: tasks },
      { kind: 'properties', label: 'imóveis', count: properties },
      { kind: 'goals', label: 'metas', count: goals + goalEntries },
      { kind: 'sales', label: 'vendas', count: sales },
      { kind: 'interactions', label: 'interações', count: interactions },
      { kind: 'shares', label: 'links de imóvel compartilhados', count: shares },
      { kind: 'activities', label: 'registros de atividade diária', count: activities },
      { kind: 'team', label: 'equipes que coordena', count: coordinated },
    ]
    return all.filter((blocker) => blocker.count > 0)
  }

  /** Exclusão definitiva e irreversível: só diretor, e só de quem não tem nada vinculado */
  async remove(actor: Actor, id: string) {
    if (id === actor.id) throw new ForbiddenException('Você não pode excluir a si mesmo')
    const target = await this.findById(actor.organizationId, id)
    assertCanManage(actor, target.role)
    await this.assertNotLastDirector(actor.organizationId, target, false)

    const blockers = await this.deleteBlockers(actor.organizationId, id)
    if (blockers.length > 0) {
      const list = blockers.map((blocker) => `${blocker.count} ${blocker.label}`).join(', ')
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'USER_HAS_LINKS',
        message: `${target.name} não pode ser excluído porque tem ${list} vinculados. Transfira a carteira ou desative o usuário.`,
        blockers,
      })
    }

    await this.prisma.$transaction(async (tx) => {
      // O registro vai na mesma transação: se a exclusão falhar, nada fica gravado pela metade
      await tx.billingEvent.create({
        data: {
          organizationId: actor.organizationId,
          kind: 'usuario_excluido',
          createdBy: actor.email ?? actor.id,
          description: `Usuário ${target.name} (${target.email}, ${target.role}) excluído definitivamente`,
          data: { userId: id, email: target.email, role: target.role },
        },
      })
      await tx.user.delete({ where: { id } })
    })
    return { ok: true }
  }

  /** Gestor define a senha de alguém. Muda o updatedAt, então as sessões dessa pessoa caem */
  async resetPassword(actor: Actor, id: string, dto: ResetPasswordDto) {
    const target = await this.findById(actor.organizationId, id)
    assertCanManage(actor, target.role)
    const passwordHash = await this.authService.hashPassword(dto.password)
    await this.prisma.user.update({ where: { id }, data: { passwordHash }, select: { id: true } })
    return { ok: true }
  }
}
