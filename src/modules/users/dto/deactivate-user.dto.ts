import { IsOptional, IsString, MaxLength } from 'class-validator'

export class DeactivateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string
}
