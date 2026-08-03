import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { LeadsService } from './leads.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { QueryLeadDto } from './dto/query-lead.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('leads')
export class LeadsController {
  constructor(private service: LeadsService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Body() dto: CreateLeadDto,
  ) {
    return this.service.create(user.organizationId, dto, user)
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Query() query: QueryLeadDto,
  ) {
    return this.service.findAll(user.organizationId, query, user)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id, user)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateLeadDto>,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Patch(':id/stage')
  updateStage(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body('funnelStageId') funnelStageId: string,
  ) {
    return this.service.updateStage(user.organizationId, id, funnelStageId)
  }

  @Patch(':id/lost')
  markAsLost(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body('lostReason') lostReason: string,
  ) {
    return this.service.markAsLost(user.organizationId, id, lostReason)
  }

  @Delete(':id')
  archive(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.archive(user.organizationId, id)
  }

  @Post(':id/tags/:tagId')
  addTag(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.service.addTag(user.organizationId, id, tagId)
  }

  @Delete(':id/tags/:tagId')
  removeTag(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.service.removeTag(user.organizationId, id, tagId)
  }
}
