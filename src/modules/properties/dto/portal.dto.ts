import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { PORTAL_LIMITS, PROPERTY_FEATURE_VALUES, PROPERTY_TYPE_VALUES } from '../portal.config'
import { Trim } from './property-validators'

/** Rascunho parcial do formulário: só para avaliar, nada é gravado. Sem limites de tamanho (a avaliação aponta) */
export class PortalReadinessDto {
  @IsOptional()
  @IsString()
  propertyType?: string

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number

  @IsOptional()
  @IsString()
  cep?: string

  @IsOptional()
  @IsString()
  state?: string

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  neighborhood?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  areaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lotAreaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bedrooms?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bathrooms?: number
}

/** Entrada da IA: sem rua, número, CEP nem dados do proprietário */
export class AiDescribeDto {
  @IsIn(PROPERTY_TYPE_VALUES)
  propertyType: string

  @Trim()
  @IsString()
  @IsNotEmpty()
  neighborhood: string

  @Trim()
  @IsString()
  @IsNotEmpty()
  city: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  areaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lotAreaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  suites?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  parkingSpots?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitFloor?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearBuilt?: number

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PORTAL_LIMITS.FEATURES_MAX)
  @IsIn(PROPERTY_FEATURE_VALUES, { each: true })
  features?: string[]

  @IsOptional()
  @IsBoolean()
  acceptsFgts?: boolean

  @IsOptional()
  @IsBoolean()
  acceptsFinancing?: boolean
}
