import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class QueryLeadDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsString()
  funnelStageId?: string

  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsString()
  teamId?: string

  @IsOptional()
  @IsString()
  urgency?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
