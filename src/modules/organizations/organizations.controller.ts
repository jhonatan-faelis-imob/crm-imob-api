import { Controller, Get, Post, Patch, Body, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { OrganizationsService, PublicSignupGuard } from './organizations.service'
import { OnboardingDto } from './dto/onboarding.dto'
import { UpdateMyOrganizationDto } from './dto/update-my-organization.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { clientIp } from '../../common/utils/rate-limiter'

// Criar organização é pelo painel /admin (POST /admin/organizations) ou pelo onboarding, quando ligado

@Controller('organizations')
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  /** Desligado por padrão (PUBLIC_SIGNUP_ENABLED): 403 */
  @Public()
  @UseGuards(PublicSignupGuard)
  @Post('onboarding')
  onboarding(@Body() dto: OnboardingDto, @Req() request: Request) {
    return this.service.onboarding(dto, clientIp(request))
  }

  @Get('me')
  getMyOrg(@CurrentUser() user: { organizationId: string }) {
    return this.service.findById(user.organizationId)
  }

  @Patch('me')
  @Roles('diretor')
  updateMyOrg(@CurrentUser() user: { organizationId: string }, @Body() dto: UpdateMyOrganizationDto) {
    return this.service.update(user.organizationId, dto)
  }
}
