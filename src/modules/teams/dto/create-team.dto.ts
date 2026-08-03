import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator'

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsOptional()
  @IsUUID()
  coordinatorId?: string
}
