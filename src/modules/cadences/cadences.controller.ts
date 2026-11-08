import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { CadencesService } from './cadences.service'
import { ApplyExistingDto, ReorderStepsDto } from './dto/cadence-actions.dto'
import { CreateCadenceStepDto, UpdateCadenceStepDto } from './dto/cadence-step.dto'

type AuthenticatedUser = { id: string; organizationId: string; role: string; teamId: string | null }

@Controller('cadences')
export class CadencesController {
  constructor(private service: CadencesService) {}

  // Leitura liberada: o Kanban mostra os passos de cada etapa para todos os perfis
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.organizationId)
  }

  // Mesma visibilidade do detalhe do lead
  @Get('lead/:leadId')
  findForLead(@CurrentUser() user: AuthenticatedUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.service.findForLead(user.organizationId, leadId, user)
  }

  @Post('lead/:leadId/reapply')
  reapplyForLead(@CurrentUser() user: AuthenticatedUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.service.reapplyForLead(user.organizationId, leadId, user)
  }

  // A cadência vale para toda a imobiliária: só gerente ou superior altera
  @Post('stages/:stageId/apply-existing')
  @Roles('gerente')
  applyToExistingLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: ApplyExistingDto,
  ) {
    return this.service.applyToExistingLeads(user.organizationId, stageId, dto.dryRun, user.id)
  }

  @Post('steps')
  @Roles('gerente')
  createStep(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCadenceStepDto) {
    return this.service.createStep(user.organizationId, dto)
  }

  // Antes de steps/:id, senão "reorder" cairia no ParseUUIDPipe
  @Patch('steps/reorder')
  @Roles('gerente')
  reorderSteps(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReorderStepsDto) {
    return this.service.reorderSteps(user.organizationId, dto)
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
