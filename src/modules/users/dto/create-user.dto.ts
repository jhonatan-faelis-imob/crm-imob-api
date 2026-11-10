import { IsString, IsEmail, IsNotEmpty, IsOptional, IsIn, IsUUID, MinLength } from 'class-validator'
import { ROLES } from '../user-permissions'

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsEmail()
  email: string

  /** Sem senha: o backend gera uma e devolve uma única vez em temporaryPassword */
  @IsOptional()
  @IsString()
  @MinLength(6)
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
