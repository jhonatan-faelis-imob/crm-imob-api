import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { TeamsService } from './teams.service'
import { CreateTeamDto } from './dto/create-team.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('teams')
export class TeamsController {
  constructor(private service: TeamsService) {}

  @Post()
  @Roles('gerente')
  create(
    @CurrentUser() user: { organizationId: string },
    @Body() dto: CreateTeamDto,
  ) {
    return this.service.create(user.organizationId, dto)
  }

  @Get()
  findAll(@CurrentUser() user: { organizationId: string }) {
    return this.service.findAll(user.organizationId)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id)
  }

  @Patch(':id')
  @Roles('gerente')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateTeamDto>,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Delete(':id')
  @Roles('diretor')
  deactivate(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.deactivate(user.organizationId, id)
  }
}
