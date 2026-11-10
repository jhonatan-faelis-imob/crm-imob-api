import { IsString, IsEmail, IsNotEmpty, IsOptional, IsIn, IsUUID, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'
import { trimLowerEmail } from '../../../common/utils/email'
import { ROLES } from '../user-permissions'

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @Transform(trimLowerEmail)
  @IsEmail()
  email: string

  /** Sem senha: o backend gera uma e devolve uma única vez em temporaryPassword */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  password?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  creci?: string

  @IsIn(ROLES)
  role: string

  /** Opcional: dá para criar sem equipe e definir depois */
  @IsOptional()
  @IsUUID()
  teamId?: string | null
}
