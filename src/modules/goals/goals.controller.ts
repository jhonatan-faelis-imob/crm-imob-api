import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { GoalsService } from './goals.service'
import { CreateGoalDto } from './dto/create-goal.dto'
import { CreateDailyEntryDto } from './dto/create-daily-entry.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('goals')
export class GoalsController {
  constructor(private service: GoalsService) {}

  @Post()
  create(
    @CurrentUser() user: { organizationId: string },
    @Body() dto: CreateGoalDto,
  ) {
    return this.service.create(user.organizationId, dto)
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string; organizationId: string; role: string },
  ) {
    return this.service.findAll(user.organizationId, user)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id)
  }

  @Post(':id/entries')
  upsertEntry(
    @CurrentUser() user: { id: string; organizationId: string },
    @Param('id') id: string,
    @Body() dto: CreateDailyEntryDto,
  ) {
    return this.service.upsertDailyEntry(user.organizationId, id, user.id, dto)
  }

  @Get(':id/entries')
  getEntries(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.getDailyEntries(user.organizationId, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Param('id') id: string,
    @Body() dto: Partial<CreateGoalDto>,
  ) {
    return this.service.update(user.organizationId, id, dto, user)
  }

  @Patch(':id/progress')
  updateProgress(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.updateProgress(user.organizationId, id)
  }

  @Delete(':id')
  @Roles('gerente')
  deactivate(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.deactivate(user.organizationId, id)
  }
}
