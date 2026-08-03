import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common'
import { OrganizationsService } from './organizations.service'
import { CreateOrganizationDto } from './dto/create-organization.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { Public } from '../../common/decorators/public.decorator'

@Controller('organizations')
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  @Post()
  @Roles('diretor')
  create(@Body() dto: CreateOrganizationDto) {
    return this.service.create(dto)
  }

  @Public()
  @Post('onboarding')
  async onboarding(@Body() body: {
    orgName: string
    slug: string
    name: string
    email: string
    phone?: string
    password: string
  }) {
    return this.service.onboarding(body)
  }

  @Get('me')
  getMyOrg(@CurrentUser() user: { organizationId: string }) {
    return this.service.findById(user.organizationId)
  }

  @Patch('me')
  @Roles('diretor')
  updateMyOrg(
    @CurrentUser() user: { organizationId: string },
    @Body() dto: Partial<CreateOrganizationDto>,
  ) {
    return this.service.update(user.organizationId, dto)
  }
}
