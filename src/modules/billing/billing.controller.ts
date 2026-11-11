import { Body, Controller, Get, Patch } from '@nestjs/common'
import { AllowWhenBlocked } from '../../common/decorators/allow-when-blocked.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { BillingService } from './billing.service'
import { BillingInfoDto } from './dto/billing-info.dto'

type BillingUser = { organizationId: string; email: string; role: string }

@Controller('billing')
@AllowWhenBlocked()
export class BillingController {
  constructor(private service: BillingService) {}

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
}
