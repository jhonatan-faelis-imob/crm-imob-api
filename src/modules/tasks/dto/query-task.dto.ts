import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class QueryTaskDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsIn(['pendente','concluida','cancelada'])
  status?: string

  @IsOptional()
  @IsIn(['ligacao','whatsapp','email','visita','reuniao','outro'])
  type?: string

  @IsOptional()
  @IsIn(['baixa','media','alta'])
  priority?: string

  @IsOptional()
  @IsString()
  assignedTo?: string

  @IsOptional()
  @IsString()
  leadId?: string

  @IsOptional()
  @IsString()
  period?: string // 'today' | 'week' | 'month' | 'overdue'

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
