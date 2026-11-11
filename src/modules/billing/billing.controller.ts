import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common'
import { AllowWhenBlocked } from '../../common/decorators/allow-when-blocked.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { AsaasBillingService } from './asaas/asaas-billing.service'
import { BillingService } from './billing.service'
import { BillingInfoDto } from './dto/billing-info.dto'
import { CancelSubscriptionDto, ChangeSubscriptionDto, SubscribeDto } from './dto/subscription.dto'

type BillingUser = { organizationId: string; email: string; role: string }

@Controller('billing')
@AllowWhenBlocked()
export class BillingController {
  constructor(
    private service: BillingService,
    private asaas: AsaasBillingService,
  ) {}

  /** Catálogo de planos (fonte única: plans.config.ts) */
  @Get('plans')
  plans() {
    return this.service.plans()
  }

  @Get('me')
  me(@CurrentUser() user: BillingUser) {
    return this.service.me(user)
  }

  /** Só dados de cobrança; plano, assentos e situação mudam pelo painel /admin */
  @Patch('me')
  @Roles('diretor')
  update(@CurrentUser() user: BillingUser, @Body() dto: BillingInfoDto) {
    return this.service.updateBillingInfo(user.organizationId, dto)
  }

  /** Cria a assinatura no Asaas e devolve a página de pagamento. Quem libera o acesso é o webhook */
  @Post('subscribe')
  @Roles('diretor')
  subscribe(@CurrentUser() user: BillingUser, @Body() dto: SubscribeDto) {
    return this.asaas.subscribe(user, dto)
  }

  /** Plano e usuários; vale a partir da próxima cobrança, sem proporcional */
  @Patch('subscription')
  @Roles('diretor')
  changeSubscription(@CurrentUser() user: BillingUser, @Body() dto: ChangeSubscriptionDto) {
    return this.asaas.changeSubscription(user, dto)
  }

  /** Remove no Asaas; o acesso segue até o fim do período */
  @Post('subscription/cancel')
  @HttpCode(200)
  @Roles('diretor')
  cancel(@CurrentUser() user: BillingUser, @Body() dto: CancelSubscriptionDto) {
    return this.asaas.cancel(user, dto)
  }

  /** Últimas 24 cobranças */
  @Get('payments')
  payments(@CurrentUser() user: BillingUser) {
    return this.asaas.payments(user.organizationId)
  }
}
