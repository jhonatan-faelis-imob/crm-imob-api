import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { canCoordinate, canManageUser, forbiddenRoleMessage, type Actor } from '../users/user-permissions'

// Regras de equipe usadas por users e teams (as duas rotas mexem em teamId e coordinatorId)

type Db = Prisma.TransactionClient

/** A equipe existe, está ativa e é da organização. 400 se não for */
export async function assertTeamInOrganization(db: Db, organizationId: string, teamId: string) {
  const team = await db.team.findFirst({ where: { id: teamId, organizationId, active: true }, select: { id: true } })
  if (!team) throw new BadRequestException('Equipe não encontrada nesta organização')
}

/** Equipe ativa que essa pessoa coordena, fora a informada */
export function findCoordinatedTeam(db: Db, userId: string, exceptTeamId?: string) {
  return db.team.findFirst({
    where: { coordinatorId: userId, active: true, ...(exceptTeamId ? { id: { not: exceptTeamId } } : {}) },
    select: { id: true, name: true },
  })
}

/**
 * Valida quem vai coordenar a equipe: da organização, cargo coordenador ou superior,
 * gerível por quem age e sem coordenar outra equipe
 */
export async function validateCoordinator(db: Db, actor: Actor, coordinatorId: string, teamId?: string) {
  const user = await db.user.findFirst({
    where: { id: coordinatorId, organizationId: actor.organizationId },
    select: { id: true, name: true, role: true },
  })
  if (!user) throw new BadRequestException('Coordenador não encontrado nesta organização')
  if (!canCoordinate(user.role)) throw new BadRequestException('Só coordenador ou superior pode coordenar uma equipe')
  if (!canManageUser(actor.role, user.role)) throw new ForbiddenException(forbiddenRoleMessage(user.role))
  const other = await findCoordinatedTeam(db, user.id, teamId)
  if (other) throw new ConflictException(`${user.name} já coordena a equipe "${other.name}". Troque o coordenador de lá antes.`)
  return user
}

/**
 * Muda a equipe mantendo o updatedAt: trocar de equipe não encerra as sessões da pessoa
 * (o token carimba o updatedAt; ver auth/session-stamp.ts). O teamId é sempre lido do banco a cada requisição
 */
export async function setTeamKeepingSessions(db: Db, where: Prisma.UserWhereInput, teamId: string | null) {
  const users = await db.user.findMany({ where, select: { id: true, updatedAt: true } })
  for (const user of users) {
    await db.user.update({ where: { id: user.id }, data: { teamId, updatedAt: user.updatedAt } })
  }
}
