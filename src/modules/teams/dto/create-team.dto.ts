import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator'

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  name: string

  /** Opcional: dá para criar a equipe e definir o coordenador depois. null remove */
  @IsOptional()
  @IsUUID()
  coordinatorId?: string | null
}
