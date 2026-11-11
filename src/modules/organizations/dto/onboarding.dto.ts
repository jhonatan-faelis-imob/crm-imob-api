import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { trimLowerEmail } from '../../../common/utils/email'

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

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  @MaxLength(72)
  password: string
}
