import { Module } from '@nestjs/common'
import { InteractionsModule } from '../interactions/interactions.module'
import { LeadsModule } from '../leads/leads.module'
import { PropertySharesController, PublicSharesController } from './property-shares.controller'
import { PropertySharesService } from './property-shares.service'

@Module({
  imports: [LeadsModule, InteractionsModule],
  providers: [PropertySharesService],
  controllers: [PropertySharesController, PublicSharesController],
})
export class PropertySharesModule {}
