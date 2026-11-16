import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator'
import { ROLES } from '../user-permissions'

export const ACTIVE_FILTERS = ['true', 'false', 'all'] as const
export type ActiveFilter = (typeof ACTIVE_FILTERS)[number]

export class ListUsersQueryDto {
  /** UUID de uma equipe ou "none" para quem está sem equipe */
  @ValidateIf((query: ListUsersQueryDto) => query.teamId !== undefined && query.teamId !== 'none')
  @IsUUID(undefined, { message: 'teamId deve ser o id de uma equipe ou "none"' })
  teamId?: string

  @IsOptional()
  @IsIn(ROLES)
  role?: string

  /** Padrão true (só ativos). false e all: coordenador ou superior */
  @IsOptional()
  @IsIn(ACTIVE_FILTERS, { message: 'active deve ser true, false ou all' })
  active?: ActiveFilter
}
