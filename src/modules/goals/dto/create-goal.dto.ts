import {
  IsString, IsNotEmpty, IsOptional, IsIn,
  IsNumber, IsInt, IsDateString, IsUUID, IsPositive, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class ConversionRatesDto {
  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  appointmentsPerClosing?: number

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  simulationsPerAppointment?: number

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  qualificationsPerSimulation?: number

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  prospectsPerQualification?: number

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  callsPerProspect?: number
}

export class CreateGoalDto {
  @IsIn(['organizacao', 'equipe', 'individual'])
  scope: 'organizacao' | 'equipe' | 'individual'

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
  targetValue?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  avgTicket?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionPct?: number

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversionRatesDto)
  conversionRates?: ConversionRatesDto
}
