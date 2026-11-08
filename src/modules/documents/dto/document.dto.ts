import { PartialType } from '@nestjs/mapped-types'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator'
import {
  CHECKLIST_STATUSES,
  DOCUMENT_APPLIES_WHEN,
  DOCUMENT_CATEGORIES,
  DOCUMENT_HOLDERS,
  MAX_BULK_ITEMS,
} from '../checklist-rules'

export class CreateRequirementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: string

  @IsOptional()
  @IsIn(DOCUMENT_HOLDERS)
  holder?: string

  @IsOptional()
  @IsBoolean()
  required?: boolean

  @IsOptional()
  @IsIn(DOCUMENT_APPLIES_WHEN)
  appliesWhen?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class UpdateRequirementDto extends PartialType(CreateRequirementDto) {}

export class ReorderRequirementsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  orderedIds: string[]
}

export class CreateChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: string

  @IsOptional()
  @IsIn(DOCUMENT_HOLDERS)
  holder?: string

  @IsOptional()
  @IsBoolean()
  required?: boolean
}

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsIn(CHECKLIST_STATUSES)
  status?: (typeof CHECKLIST_STATUSES)[number]

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string

  // Só em item avulso
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string
}

export class BulkChecklistDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ITEMS)
  @IsUUID('all', { each: true })
  ids: string[]

  @IsIn(CHECKLIST_STATUSES)
  status: (typeof CHECKLIST_STATUSES)[number]
}
