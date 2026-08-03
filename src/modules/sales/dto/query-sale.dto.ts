import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class QuerySaleDto {
  @IsOptional()
  @IsString()
  brokerId?: string

  @IsOptional()
  @IsString()
  teamId?: string

  @IsOptional()
  @IsString()
  propertyId?: string

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  startDate?: string

  @IsOptional()
  @IsString()
  endDate?: string

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
