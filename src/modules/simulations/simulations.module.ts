import { Module } from '@nestjs/common'
import { SimulationsController } from './simulations.controller'
import { SimulationsService } from './simulations.service'

@Module({
  providers: [SimulationsService],
  controllers: [SimulationsController],
})
export class SimulationsModule {}
