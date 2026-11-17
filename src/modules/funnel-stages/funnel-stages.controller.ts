import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { FunnelStagesService } from './funnel-stages.service'
import { CreateFunnelStageDto, UpdateFunnelStageDto } from './dto/create-funnel-stage.dto'
import { MoveLeadsDto, ReorderStagesDto } from './dto/stage-actions.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('funnel-stages')
export class FunnelStagesController {
  constructor(private service: FunnelStagesService) {}

  @Get()
  findAll(@CurrentUser() user: { organizationId: string }) {
    return this.service.findAll(user.organizationId)
  }

  @Post()
  @Roles('coordenador')
  create(@CurrentUser() user: { organizationId: string }, @Body() dto: CreateFunnelStageDto) {
    return this.service.create(user.organizationId, dto)
  }

  @Patch('reorder')
  @Roles('coordenador')
  reorder(@CurrentUser() user: { organizationId: string }, @Body() body: ReorderStagesDto) {
    return this.service.reorder(user.organizationId, body.orders)
  }

  @Patch(':id')
  @Roles('coordenador')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdateFunnelStageDto,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Post(':id/move-leads')
  @Roles('coordenador')
  moveLeads(
    @CurrentUser() user: { organizationId: string; id: string },
    @Param('id') id: string,
    @Body() dto: MoveLeadsDto,
  ) {
    return this.service.moveLeads(user.organizationId, id, dto, user.id)
  }

  @Delete(':id')
  @Roles('coordenador')
  remove(@CurrentUser() user: { organizationId: string }, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id)
  }
}
