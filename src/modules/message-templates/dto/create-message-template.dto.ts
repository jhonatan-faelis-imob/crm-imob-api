import { Transform } from 'class-transformer'
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export const MESSAGE_TEMPLATE_TYPES = [
  'primeiro_contato',
  'follow_up',
  'agendamento',
  'pos_visita',
  'proposta',
  'pos_venda',
  'outro',
]

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class CreateMessageTemplateDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string

  @IsOptional()
  @IsIn(MESSAGE_TEMPLATE_TYPES)
  type?: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean
}
