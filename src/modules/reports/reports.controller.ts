import { Controller, Get, Query } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('dashboard')
  getDashboard(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
  ) {
    return this.service.getDashboard(user.organizationId, user.id, user.role, user.teamId)
  }

  @Get('sales-by-period')
  getSalesByPeriod(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'day' | 'month' = 'month',
  ) {
    return this.service.getSalesByPeriod(user.organizationId, startDate, endDate, groupBy)
  }

  @Get('broker-ranking')
  getBrokerRanking(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.service.getBrokerRanking(user.organizationId, startDate, endDate)
  }

  @Get('sales-by-property')
  getSalesByProperty(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.service.getSalesByProperty(user.organizationId, startDate, endDate)
  }

  @Get('leads-by-source')
  getLeadsBySource(@CurrentUser() user: { organizationId: string }) {
    return this.service.getLeadsBySource(user.organizationId)
  }

  @Get('sales-by-team')
  getSalesByTeam(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.service.getSalesByTeam(user.organizationId, startDate, endDate)
  }

  @Get('sales-by-income-bracket')
  getSalesByIncomeBracket(
    @CurrentUser() user: { organizationId: string },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.service.getSalesByIncomeBracket(user.organizationId, startDate, endDate)
  }
}
