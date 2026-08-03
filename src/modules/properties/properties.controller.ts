import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { PropertiesService } from './properties.service'
import { CreatePropertyDto } from './dto/create-property.dto'
import { QueryPropertyDto } from './dto/query-property.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('properties')
export class PropertiesController {
  constructor(private service: PropertiesService) {}

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
    @Body() dto: Partial<CreatePropertyDto>,
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
