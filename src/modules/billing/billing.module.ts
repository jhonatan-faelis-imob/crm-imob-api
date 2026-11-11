import { Global, Module } from '@nestjs/common'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { SubscriptionCache } from './subscription-cache'

/** Global: o SubscriptionGuard (APP_GUARD) e o painel /admin usam o mesmo cache */
@Global()
@Module({
  providers: [BillingService, SubscriptionCache],
  controllers: [BillingController],
  exports: [BillingService, SubscriptionCache],
})
export class BillingModule {}
