import { AllowWhenBlocked } from '../../common/decorators/allow-when-blocked.decorator'
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { CalculateSimulationDto } from './dto/calculate-simulation.dto'
import { SimulationsService } from './simulations.service'

// Liberado para todos os perfis; nada é salvo
@Controller('simulations')
export class SimulationsController {
  constructor(private service: SimulationsService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig()
  }

  // Só calcula, não grava: liberado com a assinatura bloqueada
  @AllowWhenBlocked()
  @Post('calculate')
  @HttpCode(200)
  calculate(@CurrentUser() user: { organizationId: string }, @Body() dto: CalculateSimulationDto) {
    return this.service.calculate(user.organizationId, dto)
  }
}
