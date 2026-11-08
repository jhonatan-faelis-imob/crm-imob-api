import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode } from '@nestjs/common'
import { PropertiesService } from './properties.service'
import { CreatePropertyDto } from './dto/create-property.dto'
import { QueryPropertyDto } from './dto/query-property.dto'
import { UpdatePropertyDto } from './dto/update-property.dto'
import { AiDescribeDto, PortalReadinessDto } from './dto/portal.dto'
import { AiService } from '../ai/ai.service'
import { AiDescribeRateLimiter } from './ai-describe-rate-limiter'
import { portalConfig } from './portal.config'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('properties')
export class PropertiesController {
  constructor(
    private service: PropertiesService,
    private ai: AiService,
    private aiLimiter: AiDescribeRateLimiter,
  ) {}

  // Rotas fixas antes das rotas com :id

  @Get('portal-config')
  getPortalConfig() {
    return portalConfig()
  }

  /** Checklist ao vivo do formulário: avalia o rascunho e não grava nada */
  @Post('portal-readiness')
  @HttpCode(200)
  checkPortalReadiness(@Body() dto: PortalReadinessDto) {
    return this.service.readiness(dto)
  }

  /** Título e descrição pela IA (qualquer perfil, 20 por hora por usuário) */
  @Post('ai/describe')
  @HttpCode(200)
  describeWithAi(@CurrentUser() user: { id: string }, @Body() dto: AiDescribeDto) {
    this.aiLimiter.consume(user.id)
    return this.ai.describeProperty(dto)
  }

  @Post()
  @Roles('corretor')
  create(
    @CurrentUser() user: { id: string; organizationId: string },
    @Body() dto: CreatePropertyDto,
  ) {
    return this.service.create(user.organizationId, user.id, dto)
  }

  @Get()
  findAll(
    @CurrentUser() user: { organizationId: string },
    @Query() query: QueryPropertyDto,
  ) {
    return this.service.findAll(user.organizationId, query)
  }

  @Get('income-match/:income')
  findByIncome(
    @CurrentUser() user: { organizationId: string },
    @Param('income') income: string,
  ) {
    return this.service.findByIncomeMatch(user.organizationId, Number(income))
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Patch(':id/sold')
  @Roles('corretor')
  markAsSold(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.markAsSold(user.organizationId, id)
  }

  @Delete(':id')
  @Roles('coordenador')
  deactivate(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.deactivate(user.organizationId, id)
  }

  @Post(':id/leads/:leadId')
  addLeadLink(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Param('leadId') leadId: string,
    @Body('notes') notes?: string,
  ) {
    return this.service.addLeadLink(user.organizationId, id, leadId, notes)
  }

  @Delete(':id/leads/:leadId')
  removeLeadLink(
    @Param('id') id: string,
    @Param('leadId') leadId: string,
  ) {
    return this.service.removeLeadLink(id, leadId)
  }
}
