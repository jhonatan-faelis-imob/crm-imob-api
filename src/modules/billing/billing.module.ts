import { Global, Module } from '@nestjs/common'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { AsaasBillingService } from './asaas/asaas-billing.service'
import { AsaasClient } from './asaas/asaas.client'
import { AsaasWebhookController } from './asaas/asaas-webhook.controller'
import { AsaasWebhookService } from './asaas/asaas-webhook.service'
import { SubscriptionCache } from './subscription-cache'

/** Global: o SubscriptionGuard (APP_GUARD) e o painel /admin usam o mesmo cache */
@Global()
@Module({
  providers: [BillingService, SubscriptionCache, AsaasClient, AsaasBillingService, AsaasWebhookService],
  controllers: [BillingController, AsaasWebhookController],
  exports: [BillingService, SubscriptionCache, AsaasBillingService, AsaasWebhookService],
})
export class BillingModule {}
