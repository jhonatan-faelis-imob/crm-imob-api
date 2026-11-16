import { IsString, IsOptional, IsIn, IsUUID, IsEmail } from 'class-validator'
import { Transform } from 'class-transformer'
import { trimLowerEmail } from '../../../common/utils/email'
import { ROLES } from '../user-permissions'

/** Desativar e reativar têm rotas próprias (PATCH /users/:id/deactivate e /activate): `active` não é aceito aqui */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string

  /** Só gerente ou superior altera o e-mail (conferido no serviço) */
  @IsOptional()
  @Transform(trimLowerEmail)
  @IsEmail({}, { message: 'Email inválido' })
  email?: string

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
}
