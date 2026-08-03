import { IsInt, IsOptional, IsString, IsDateString, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateDailyEntryDto {
  @IsDateString()
  date: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  calls?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  prospects?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  qualifications?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  simulations?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  appointments?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  closings?: number

  @IsOptional()
  @IsString()
  notes?: string
}
