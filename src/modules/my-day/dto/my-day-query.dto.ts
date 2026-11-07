import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { MAX_ITEMS } from '../my-day.config'

export class MyDaySummaryQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string
}

export class MyDayQueryDto extends MyDaySummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEMS)
  limit?: number
}
