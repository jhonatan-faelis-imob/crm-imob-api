import { Module } from '@nestjs/common'
import { InteractionsModule } from '../interactions/interactions.module'
import { LeadsModule } from '../leads/leads.module'
import { MessageTemplatesController } from './message-templates.controller'
import { MessageTemplatesService } from './message-templates.service'

@Module({
  imports: [InteractionsModule, LeadsModule],
  providers: [MessageTemplatesService],
  controllers: [MessageTemplatesController],
})
export class MessageTemplatesModule {}
