import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator'
import { ROLES } from '../user-permissions'

export class ListUsersQueryDto {
  /** UUID de uma equipe ou "none" para quem está sem equipe */
  @ValidateIf((query: ListUsersQueryDto) => query.teamId !== undefined && query.teamId !== 'none')
  @IsUUID(undefined, { message: 'teamId deve ser o id de uma equipe ou "none"' })
  teamId?: string

  @IsOptional()
  @IsIn(ROLES)
  role?: string
}
