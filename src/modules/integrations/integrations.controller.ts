import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { IntakeConfigDto, QueryEventsDto } from './dto/integrations.dto'
import { GoogleAdsService, type IntegrationUser } from './google-ads/google-ads.service'
import { IntegrationsService } from './integrations.service'

// Rotas fixas (google-ads/...) em controller próprio, registrado antes do que tem :provider

@Controller('integrations/google-ads')
@Roles('gerente')
export class GoogleAdsController {
  constructor(private service: GoogleAdsService) {}

  @Get()
  get(@CurrentUser() user: IntegrationUser) {
    return this.service.getView(user.organizationId)
  }

  @Post('enable')
  @HttpCode(200)
  enable(@CurrentUser() user: IntegrationUser, @Body() dto: IntakeConfigDto) {
    return this.service.enable(user, dto)
  }

  @Patch()
  update(@CurrentUser() user: IntegrationUser, @Body() dto: IntakeConfigDto) {
    return this.service.updateConfig(user, dto)
  }

  @Post('disable')
  @HttpCode(200)
  disable(@CurrentUser() user: IntegrationUser) {
    return this.service.disable(user)
  }

  @Get('secret')
  secret(@CurrentUser() user: IntegrationUser) {
    return this.service.revealSecret(user)
  }

  @Post('rotate-key')
  @HttpCode(200)
  rotateKey(@CurrentUser() user: IntegrationUser) {
    return this.service.rotateKey(user)
  }
}

@Controller('integrations')
@Roles('gerente')
export class IntegrationsController {
  constructor(private service: IntegrationsService) {}

  @Get()
  catalog(@CurrentUser() user: { organizationId: string }) {
    return this.service.catalog(user.organizationId)
  }

  @Get(':provider/events')
  events(
    @CurrentUser() user: { organizationId: string },
    @Param('provider') provider: string,
    @Query() query: QueryEventsDto,
  ) {
    return this.service.listEvents(user.organizationId, provider, query.limit)
  }
}

/**
 * Webhook do Google Ads, sem login. O corpo é lido como unknown (o ValidationPipe não atua) e validado
 * à mão: o Google manda campos que não conhecemos. Limite de 100 KB no main.ts
 */
@Public()
@Controller('public/integrations/google-ads')
export class PublicGoogleAdsController {
  constructor(private service: GoogleAdsService) {}

  @Post(':token')
  @HttpCode(200)
  receive(@Param('token') token: string, @Body() body: unknown) {
    return this.service.receive(token, body)
  }
}
