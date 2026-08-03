import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class QueryPropertyDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsIn(['empreendimento','revenda'])
  kind?: string

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  propertyStatus?: string

  @IsOptional()
  @IsString()
  minPrice?: string

  @IsOptional()
  @IsString()
  maxPrice?: string

  @IsOptional()
  @IsString()
  minIncome?: string

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20
}
