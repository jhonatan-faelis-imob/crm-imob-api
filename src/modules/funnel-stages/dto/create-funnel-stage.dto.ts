import { Transform } from 'class-transformer'
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Matches, MaxLength } from 'class-validator'

export const STAGE_COLOR = /^#[0-9a-fA-F]{6}$/
const COLOR_MESSAGE = 'Cor inválida: use o formato #RRGGBB'
const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

export class CreateFunnelStageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da etapa' })
  @MaxLength(40, { message: 'O nome pode ter até 40 caracteres' })
  name: string

  @IsOptional()
  @Matches(STAGE_COLOR, { message: COLOR_MESSAGE })
  color?: string

  /** Posição (1 = primeira coluna). As etapas dessa posição em diante descem uma casa */
  @IsInt()
  @Min(1)
  orderIndex: number
}

/** Editar: só nome e cor. isDefault e a posição nunca mudam por aqui */
export class UpdateFunnelStageDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da etapa' })
  @MaxLength(40, { message: 'O nome pode ter até 40 caracteres' })
  name?: string

  @IsOptional()
  @Matches(STAGE_COLOR, { message: COLOR_MESSAGE })
  color?: string
}
