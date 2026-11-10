import { Module } from '@nestjs/common'
import { IntegrationEventsService } from './integration-events.service'
import { SecretsService } from './secrets.service'

// Separado do IntegrationsModule para o AiModule usar o cofre e os eventos sem dependência circular
@Module({
  providers: [SecretsService, IntegrationEventsService],
  exports: [SecretsService, IntegrationEventsService],
})
export class IntegrationsCoreModule {}
