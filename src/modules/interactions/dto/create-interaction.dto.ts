import { IsString, IsNotEmpty, IsIn, IsOptional, IsDateString, IsUUID } from 'class-validator'

export class CreateInteractionDto {
  @IsUUID()
  leadId: string

  @IsIn(['ligacao','whatsapp','email','visita','reuniao','outro'])
  type: string

  @IsString()
  @IsNotEmpty()
  notes: string

  @IsOptional()
  @IsDateString()
  occurredAt?: string
}
