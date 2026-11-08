import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import type { LeadAccessUser } from '../leads/leads.service'
import { DocumentsService } from './documents.service'
import {
  BulkChecklistDto,
  CreateChecklistItemDto,
  CreateRequirementDto,
  ReorderRequirementsDto,
  UpdateChecklistItemDto,
  UpdateRequirementDto,
} from './dto/document.dto'

@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

  // ---------- Lista padrão: leitura para todos, escrita para gerente ou superior ----------

  @Get('requirements')
  listRequirements(@CurrentUser() user: LeadAccessUser) {
    return this.service.listRequirements(user.organizationId)
  }

  @Post('requirements')
  @Roles('gerente')
  createRequirement(@CurrentUser() user: LeadAccessUser, @Body() dto: CreateRequirementDto) {
    return this.service.createRequirement(user.organizationId, dto)
  }

  // Antes de requirements/:id, senão "reorder" cairia no ParseUUIDPipe
  @Patch('requirements/reorder')
  @Roles('gerente')
  reorderRequirements(@CurrentUser() user: LeadAccessUser, @Body() dto: ReorderRequirementsDto) {
    return this.service.reorderRequirements(user.organizationId, dto)
  }

  @Patch('requirements/:id')
  @Roles('gerente')
  updateRequirement(
    @CurrentUser() user: LeadAccessUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.service.updateRequirement(user.organizationId, id, dto)
  }

  @Delete('requirements/:id')
  @Roles('gerente')
  removeRequirement(@CurrentUser() user: LeadAccessUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeRequirement(user.organizationId, id)
  }

  // ---------- Checklist do lead: mesma visibilidade do detalhe do lead ----------

  @Get('lead/:leadId')
  getChecklist(@CurrentUser() user: LeadAccessUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.service.getChecklist(user, leadId)
  }

  @Post('lead/:leadId/sync')
  syncChecklist(@CurrentUser() user: LeadAccessUser, @Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.service.syncChecklist(user, leadId)
  }

  @Post('lead/:leadId/items')
  addItem(
    @CurrentUser() user: LeadAccessUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.service.addItem(user, leadId, dto)
  }

  @Post('lead/:leadId/bulk')
  bulkUpdate(
    @CurrentUser() user: LeadAccessUser,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: BulkChecklistDto,
  ) {
    return this.service.bulkUpdate(user, leadId, dto)
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser() user: LeadAccessUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.service.updateItem(user, id, dto)
  }

  @Delete('items/:id')
  removeItem(@CurrentUser() user: LeadAccessUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.removeItem(user, id)
  }
}
