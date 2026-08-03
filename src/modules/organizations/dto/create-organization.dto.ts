import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator'

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsNotEmpty()
  slug: string

  @IsOptional()
  @IsIn(['free', 'starter', 'pro'])
  plan?: string
}
