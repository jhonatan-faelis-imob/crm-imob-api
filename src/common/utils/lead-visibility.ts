import { ForbiddenException } from '@nestjs/common'

export type VisibilityUser = { role: string; id: string; teamId: string | null }

// Mesma regra de LeadsService.findById: corretor só o próprio lead, coordenador só a equipe
export function assertCanViewLead(
  lead: { ownerId: string | null; teamId: string | null },
  requestingUser: VisibilityUser,
) {
  if (requestingUser.role === 'corretor' && lead.ownerId !== requestingUser.id) {
    throw new ForbiddenException('Acesso negado')
  }
  if (requestingUser.role === 'coordenador' && lead.teamId !== requestingUser.teamId) {
    throw new ForbiddenException('Acesso negado')
  }
}
