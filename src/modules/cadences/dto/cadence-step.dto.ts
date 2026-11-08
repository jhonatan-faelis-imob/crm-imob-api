import { OmitType, PartialType } from '@nestjs/mapped-types'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export const CADENCE_TASK_TYPES = ['ligacao', 'whatsapp', 'email', 'visita', 'reuniao', 'outro'] as const
export const CADENCE_PRIORITIES = ['baixa', 'media', 'alta'] as const

export class CreateCadenceStepDto {
  @IsUUID()
  funnelStageId: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string

  @IsOptional()
  @IsIn(CADENCE_TASK_TYPES)
  type?: string

  @IsOptional()
  @IsIn(CADENCE_PRIORITIES)
  priority?: string

  @IsInt()
  @Min(0)
  @Max(365)
  offsetDays: number

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'dueTime deve estar no formato HH:mm' })
  dueTime?: string

  @IsOptional()
  @IsBoolean()
  skipWeekends?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

// A etapa não muda depois de criado: mover um passo é excluir e criar de novo
export class UpdateCadenceStepDto extends PartialType(OmitType(CreateCadenceStepDto, ['funnelStageId'] as const)) {}
