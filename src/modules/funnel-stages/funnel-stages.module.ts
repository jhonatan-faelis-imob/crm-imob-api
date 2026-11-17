import { Module } from '@nestjs/common'
import { LeadsModule } from '../leads/leads.module'
import { FunnelStagesService } from './funnel-stages.service'
import { FunnelStagesController } from './funnel-stages.controller'

@Module({
  imports: [LeadsModule],
  providers: [FunnelStagesService],
  controllers: [FunnelStagesController],
  exports: [FunnelStagesService],
})
export class FunnelStagesModule {}
