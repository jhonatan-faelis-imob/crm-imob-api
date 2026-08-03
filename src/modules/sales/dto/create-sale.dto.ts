import {
  IsString, IsOptional, IsNumber, IsBoolean,
  IsDateString, IsUUID, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateSaleDto {
  @IsOptional()
  @IsUUID()
  leadId?: string

  @IsOptional()
  @IsUUID()
  propertyId?: string

  @IsOptional()
  @IsUUID()
  brokerId?: string

  @IsOptional()
  @IsUUID()
  teamId?: string

  @Type(() => Number)
  @IsNumber()
  saleValue: number

  @IsOptional()
  @IsString()
  unitIdentifier?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  commissionPct?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  subsidy?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  downPayment?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  financedValue?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyPayment?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  termMonths?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  interestRate?: number

  @IsDateString()
  soldAt: string

  @IsOptional()
  @IsString()
  notes?: string
}
