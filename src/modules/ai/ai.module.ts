import { Module } from '@nestjs/common'
import { IntegrationsCoreModule } from '../integrations/core/integrations-core.module'
import { AiIntegrationController } from './ai-integration.controller'
import { AiService } from './ai.service'
import { AiSettingsService } from './ai-settings.service'
import { AiController } from './ai.controller'

@Module({
  imports: [IntegrationsCoreModule],
  providers: [AiService, AiSettingsService],
  controllers: [AiController, AiIntegrationController],
  exports: [AiService],
})
export class AiModule {}
