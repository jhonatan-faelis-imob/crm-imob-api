import { Module } from '@nestjs/common'
import { FunnelStagesService } from './funnel-stages.service'
import { FunnelStagesController } from './funnel-stages.controller'

@Module({
  providers: [FunnelStagesService],
  controllers: [FunnelStagesController],
  exports: [FunnelStagesService],
})
export class FunnelStagesModule {}
