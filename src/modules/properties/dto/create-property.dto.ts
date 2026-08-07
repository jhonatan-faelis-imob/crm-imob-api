import {
  IsString, IsNotEmpty, IsOptional, IsIn,
  IsNumber, IsBoolean, IsInt } from 'class-validator'
import { Type } from 'class-transformer'

export class CreatePropertyDto {
  @IsIn(['empreendimento','revenda'])
  kind: string

  @IsString()
  @IsNotEmpty()
  title: string

  @IsOptional()
  @IsString()
  description?: string

  @IsString()
  @IsNotEmpty()
  city: string

  @IsOptional()
  @IsString()
  neighborhood?: string

  @IsOptional()
  @IsString()
  cep?: string

  @IsOptional()
  @IsString()
  address?: string

  @IsOptional()
  @IsString()
  state?: string

  // Empreendimento
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  totalUnits?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  startingPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number

  // Revenda
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  areaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bedrooms?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bathrooms?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parkingSpots?: number

  // Cruzamento de renda
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minIncome?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxIncome?: number

  @IsOptional()
  @IsIn([
    // Empreendimento
    'lancamento', 'em_obras', 'pronto_morar', 'entregue', 'esgotado', 'suspenso',
    // Revenda
    'disponivel', 'reservado', 'vendido',
  ])
  propertyStatus?: string

  @IsOptional()
  @IsString()
  ownerId?: string
}
