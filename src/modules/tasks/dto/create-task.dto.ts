import {
  IsString, IsNotEmpty, IsOptional, IsIn,
  IsBoolean, IsDateString, IsUUID
} from 'class-validator'

export class CreateTaskDto {
  @IsOptional()
  @IsUUID()
  leadId?: string

  @IsOptional()
  @IsUUID()
  assignedTo?: string

  @IsOptional()
  @IsUUID()
  parentTaskId?: string

  @IsString()
  @IsNotEmpty()
  title: string

  @IsOptional()
  @IsString()
  description?: string

  @IsIn(['ligacao','whatsapp','email','visita','reuniao','outro'])
  type: string

  @IsOptional()
  @IsIn(['baixa','media','alta'])
  priority?: string

  @IsDateString()
  dueDate: string

  @IsOptional()
  @IsBoolean()
  hasNextTask?: boolean
}
