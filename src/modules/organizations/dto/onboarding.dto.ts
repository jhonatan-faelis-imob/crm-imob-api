import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength, Validate } from 'class-validator'
import { trimLowerEmail } from '../../../common/utils/email'
import { CpfCnpjConstraint } from '../../billing/dto/billing-info.dto'

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export class OnboardingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  orgName: string

  @IsString()
  @Matches(SLUG_PATTERN, { message: 'Slug: só letras minúsculas, números e hífen' })
  @MaxLength(60)
  slug: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @Transform(trimLowerEmail)
  @IsEmail({}, { message: 'Email inválido' })
  email: string

  /** Obrigatório: 10 ou 11 dígitos com DDD (conferido no serviço) */
  @IsString()
  @IsNotEmpty({ message: 'Informe o telefone' })
  @MaxLength(30)
  phone: string

  /** CPF ou CNPJ, com ou sem máscara, validado pelo dígito verificador */
  @IsString()
  @Validate(CpfCnpjConstraint)
  document: string

  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  @MaxLength(72)
  password: string
}
