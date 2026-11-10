import { Module } from '@nestjs/common'
import { CadencesModule } from '../cadences/cadences.module'
import { IntegrationsCoreModule } from './core/integrations-core.module'
import { GoogleAdsService } from './google-ads/google-ads.service'
import { LeadIntakeService } from './intake/lead-intake.service'
import { GoogleAdsController, IntegrationsController, PublicGoogleAdsController } from './integrations.controller'
import { IntegrationsService } from './integrations.service'

@Module({
  imports: [IntegrationsCoreModule, CadencesModule],
  providers: [IntegrationsService, LeadIntakeService, GoogleAdsService],
  controllers: [GoogleAdsController, IntegrationsController, PublicGoogleAdsController],
  exports: [LeadIntakeService],
})
export class IntegrationsModule {}
