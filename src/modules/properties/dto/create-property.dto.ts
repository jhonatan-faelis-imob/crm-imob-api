import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import {
  IPTU_PERIODS,
  PORTAL_ADDRESS_DISPLAYS,
  PORTAL_LIMITS,
  PROPERTY_FEATURE_VALUES,
  PROPERTY_TYPE_VALUES,
} from '../portal.config'
import { OptionalNotNull, ResaleMaxLength, ResaleNoHtml, Trim } from './property-validators'

const MAX_YEAR_BUILT = new Date().getFullYear() + 5

export class CreatePropertyDto {
  @IsIn(['empreendimento', 'revenda'])
  kind: string

  /** Código do imóvel. Vazio ou ausente: automático no cadastro, mantém o atual na edição.
   *  O formato é validado e normalizado no service (normalizePropertyCode) */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string | null

  @Trim()
  @IsString()
  @IsNotEmpty()
  @ResaleMaxLength(PORTAL_LIMITS.TITLE_MAX, { message: `O título aceita no máximo ${PORTAL_LIMITS.TITLE_MAX} caracteres` })
  title: string

  @IsOptional()
  @Trim()
  @IsString()
  @ResaleMaxLength(PORTAL_LIMITS.DESC_MAX, {
    message: `A descrição aceita no máximo ${PORTAL_LIMITS.DESC_MAX} caracteres`,
  })
  @ResaleNoHtml()
  description?: string

  @Trim()
  @IsString()
  @IsNotEmpty()
  city: string

  @IsOptional()
  @Trim()
  @IsString()
  neighborhood?: string

  @IsOptional()
  @Trim()
  @IsString()
  cep?: string

  @IsOptional()
  @Trim()
  @IsString()
  address?: string

  @IsOptional()
  @Trim()
  @IsString()
  state?: string

  // Empreendimento
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalUnits?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  startingPrice?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number

  // Revenda
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number

  /** Área útil */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  areaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number

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

  // Cruzamento de renda
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minIncome?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxIncome?: number

  @IsOptional()
  @IsIn([
    // Empreendimento
    'lancamento', 'em_obras', 'pronto_morar', 'entregue', 'esgotado', 'suspenso',
    // Revenda
    'disponivel', 'reservado', 'vendido',
  ])
  propertyStatus?: string

  /** Corretor responsável */
  @IsOptional()
  @IsString()
  ownerId?: string

  // ---- Revenda preparada para portais ----

  @IsOptional()
  @IsIn(PROPERTY_TYPE_VALUES)
  propertyType?: string

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(20)
  streetNumber?: string

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  complement?: string

  /** Área total */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lotAreaM2?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  suites?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitFloor?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  buildingFloors?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1800)
  @Max(MAX_YEAR_BUILT)
  yearBuilt?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  condoFee?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  iptuValue?: number

  @IsOptional()
  @IsIn(IPTU_PERIODS)
  iptuPeriod?: string

  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(PORTAL_LIMITS.FEATURES_MAX)
  @ArrayUnique()
  @IsIn(PROPERTY_FEATURE_VALUES, { each: true, message: 'Característica fora da lista' })
  features?: string[]

  @IsOptional()
  @IsBoolean()
  acceptsFinancing?: boolean

  @IsOptional()
  @IsBoolean()
  acceptsFgts?: boolean

  @OptionalNotNull()
  @IsBoolean()
  exclusive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionPct?: number

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string

  /** Proprietário (lead da mesma organização) */
  @IsOptional()
  @IsUUID()
  sellerLeadId?: string

  @OptionalNotNull()
  @IsBoolean()
  publishToPortals?: boolean

  @OptionalNotNull()
  @IsIn(PORTAL_ADDRESS_DISPLAYS)
  portalAddressDisplay?: string
}
