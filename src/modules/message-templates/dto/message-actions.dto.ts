import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { MESSAGE_TEMPLATE_TYPES } from './create-message-template.dto'

// Maior que o limite do modelo: o texto já vem com as variáveis preenchidas
const MAX_MESSAGE_LENGTH = 4000

export class QueryMessageTemplateDto {
  @IsOptional()
  @IsIn(MESSAGE_TEMPLATE_TYPES)
  type?: string
}

export class RenderTemplateDto {
  @IsUUID()
  leadId: string
}

export class LeadMessageDto {
  @IsUUID()
  leadId: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  text: string
}
