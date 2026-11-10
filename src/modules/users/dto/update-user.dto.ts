import { IsString, IsOptional, IsIn, IsUUID, IsBoolean } from 'class-validator'
import { ROLES } from '../user-permissions'

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  creci?: string

  @IsOptional()
  @IsIn(ROLES)
  role?: string

  /** null tira a pessoa da equipe */
  @IsOptional()
  @IsUUID()
  teamId?: string | null

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
