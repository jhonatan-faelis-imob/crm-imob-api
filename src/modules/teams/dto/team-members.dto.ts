import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator'

export class TeamMembersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  addUserIds?: string[]

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  removeUserIds?: string[]
}
