import { Transform } from 'class-transformer'
import { IsEmail, IsString, MinLength } from 'class-validator'
import { trimLowerEmail } from '../../../common/utils/email'

export class LoginDto {
  @Transform(trimLowerEmail)
  @IsEmail({}, { message: 'Email inválido' })
  email: string

  // Mínimo 6 para não barrar senhas antigas; senhas novas exigem 8
  @IsString()
  @MinLength(6, { message: 'Senha deve ter no mínimo 6 caracteres' })
  password: string
}
