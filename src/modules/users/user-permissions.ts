// Regra única de quem pode criar e editar quem. O front tem uma cópia em src/features/equipe/permissions.ts

export const ROLES = ['diretor', 'gerente', 'coordenador', 'corretor', 'administrativo'] as const
export type Role = (typeof ROLES)[number]

const MANAGEABLE: Record<Role, readonly Role[]> = {
  diretor: ROLES,
  gerente: ['gerente', 'coordenador', 'corretor', 'administrativo'],
  coordenador: ['corretor', 'administrativo'],
  corretor: [],
  administrativo: [],
}

/** Cargos que podem coordenar uma equipe */
export const TEAM_COORDINATOR_ROLES: readonly Role[] = ['coordenador', 'gerente', 'diretor']

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/** O ator (actorRole) pode criar ou editar alguém com o cargo targetRole? */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  if (!isRole(actorRole) || !isRole(targetRole)) return false
  return MANAGEABLE[actorRole].includes(targetRole)
}

export function canCoordinate(role: string): boolean {
  return (TEAM_COORDINATOR_ROLES as readonly string[]).includes(role)
}

export function forbiddenRoleMessage(targetRole: string): string {
  return `Seu cargo não permite criar ou editar usuários com cargo ${targetRole}`
}

/** Quem age nas rotas de usuários e equipes (vem do JWT) */
export interface Actor {
  id: string
  organizationId: string
  role: string
  teamId: string | null
}
