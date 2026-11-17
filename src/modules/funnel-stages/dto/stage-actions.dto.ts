import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator'

export class StageOrderDto {
  @IsUUID()
  id: string

  @IsInt()
  @Min(1)
  orderIndex: number
}

export class ReorderStagesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StageOrderDto)
  orders: StageOrderDto[]
}

export class MoveLeadsDto {
  @IsUUID()
  toStageId: string
}
