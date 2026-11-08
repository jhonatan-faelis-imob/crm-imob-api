import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsUUID } from 'class-validator'
import { MAX_STEPS_PER_STAGE } from '../cadence-limits'

export class ApplyExistingDto {
  @IsBoolean()
  dryRun: boolean
}

export class ReorderStepsDto {
  @IsUUID()
  stageId: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STEPS_PER_STAGE)
  @IsUUID('all', { each: true })
  orderedIds: string[]
}
