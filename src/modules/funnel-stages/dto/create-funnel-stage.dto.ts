import { IsString, IsNotEmpty, IsOptional, IsInt, Min } from 'class-validator'

export class CreateFunnelStageDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsOptional()
  @IsString()
  color?: string

  @IsInt()
  @Min(1)
  orderIndex: number
}
