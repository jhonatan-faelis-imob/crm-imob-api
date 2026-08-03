import {
  IsString, IsNotEmpty, IsOptional, IsIn,
  IsNumber, IsInt, IsDateString, IsUUID } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateGoalDto {
  @IsOptional()
  @IsUUID()
  teamId?: string

  @IsOptional()
  @IsUUID()
  userId?: string

  @IsString()
  @IsNotEmpty()
  title: string

  @IsIn(['vgv','unidades','leads','visitas','contratos'])
  type: string

  @IsIn(['mensal','trimestral','anual','custom'])
  period: string

  @IsDateString()
  periodStart: string

  @IsDateString()
  periodEnd: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetVgv?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  avgTicket?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionPct?: number
}
