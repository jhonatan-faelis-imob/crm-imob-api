import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CadencesService } from './cadences.service'
import { CreateCadenceStepDto, UpdateCadenceStepDto } from './dto/cadence-step.dto'

type AuthenticatedUser = { id: string; organizationId: string; role: string }

@Controller('cadences')
export class CadencesController {
  constructor(private service: CadencesService) {}

  // Leitura liberada: o Kanban mostra os passos de cada etapa para todos os perfis
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.organizationId)
  }

  // A cadência vale para toda a imobiliária: só gerente ou superior altera
  @Post('steps')
  @Roles('gerente')
  createStep(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCadenceStepDto) {
    return this.service.createStep(user.organizationId, dto)
  }

  @Patch('steps/:id')
  @Roles('gerente')
  updateStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCadenceStepDto,
  ) {
    return this.service.updateStep(user.organizationId, id, dto)
  }

  @Delete('steps/:id')
  @Roles('gerente')
  removeStep(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeStep(user.organizationId, id)
  }
}
