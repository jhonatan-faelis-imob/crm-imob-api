import { IsString, MaxLength, MinLength } from 'class-validator'

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres' })
  @MaxLength(72, { message: 'A senha deve ter no máximo 72 caracteres' })
  password: string
}
