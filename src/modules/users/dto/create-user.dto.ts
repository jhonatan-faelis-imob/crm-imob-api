import { IsString, IsEmail, IsNotEmpty, IsOptional, IsIn, IsUUID, MinLength } from 'class-validator'

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsEmail()
  email: string

  @IsString()
  @MinLength(6)
  password: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  creci?: string

  @IsIn(['diretor', 'gerente', 'coordenador', 'corretor', 'administrativo'])
  role: string

  @IsOptional()
  @IsUUID()
  teamId?: string
}
