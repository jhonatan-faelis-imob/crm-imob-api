import { PartialType } from '@nestjs/mapped-types'
import { CreateTeamDto } from './create-team.dto'

// Classe de verdade (não Partial<CreateTeamDto>): com o tipo genérico o ValidationPipe não valida nada
export class UpdateTeamDto extends PartialType(CreateTeamDto) {}
