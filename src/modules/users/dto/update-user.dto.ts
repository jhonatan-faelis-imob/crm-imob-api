import { IsString, IsOptional, IsIn, IsUUID, IsBoolean } from 'class-validator'

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
  @IsIn(['diretor', 'gerente', 'coordenador', 'corretor', 'administrativo'])
  role?: string

  @IsOptional()
  @IsUUID()
  teamId?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
