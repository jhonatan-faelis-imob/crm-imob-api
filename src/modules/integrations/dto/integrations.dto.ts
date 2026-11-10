import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { MAX_FIRST_CONTACT_MINUTES } from '../intake/intake-config'

export class QueryEventsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50
}

export class AssignmentDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  userIds?: string[]
}

/** Usado na ativação e no PATCH da configuração do Google Ads */
export class IntakeConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AssignmentDto)
  assignment?: AssignmentDto

  @IsOptional()
  @IsBoolean()
  createFirstContactTask?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FIRST_CONTACT_MINUTES)
  firstContactMinutes?: number
}

export class AiFeaturesDto {
  @IsOptional()
  @IsBoolean()
  leadScore?: boolean

  @IsOptional()
  @IsBoolean()
  propertyCopy?: boolean
}

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsBoolean()
  useOwnKey?: boolean

  @IsOptional()
  @ValidateNested()
  @Type(() => AiFeaturesDto)
  features?: AiFeaturesDto
}

export class SaveAiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(300)
  apiKey: string
}
