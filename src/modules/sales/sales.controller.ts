import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common'
import { SalesService } from './sales.service'
import { CreateSaleDto } from './dto/create-sale.dto'
import { UpdateSaleStatusDto } from './dto/update-sale-status.dto'
import { QuerySaleDto } from './dto/query-sale.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('sales')
export class SalesController {
  constructor(private service: SalesService) {}

  @Post()
  @Roles('corretor')
  create(
    @CurrentUser() user: { id: string; organizationId: string; teamId: string | null },
    @Body() dto: CreateSaleDto,
  ) {
    return this.service.create(user.organizationId, user, dto)
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Query() query: QuerySaleDto,
  ) {
    return this.service.findAll(user.organizationId, query, user)
  }

  @Get('summary')
  getSummary(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getVgvSummary(user.organizationId, startDate, endDate)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id)
  }

  @Patch(':id/status')
  @Roles('coordenador')
  updateStatus(
    @CurrentUser() user: { id: string; organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdateSaleStatusDto,
  ) {
    return this.service.updateStatus(user.organizationId, id, user.id, dto)
  }
}
