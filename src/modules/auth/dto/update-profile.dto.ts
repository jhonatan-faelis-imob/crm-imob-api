import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Só o que o próprio usuário pode mudar. role, email, teamId, active e organizationId não existem aqui:
 * com o forbidNonWhitelisted global, mandar qualquer um deles dá 400
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Informe seu nome' })
  @MaxLength(120)
  name?: string

  /** Vazio limpa. Preenchido: 10 ou 11 dígitos com DDD, gravado como (DD) 9XXXX-XXXX */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  /** Vazio limpa */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  creci?: string
}
