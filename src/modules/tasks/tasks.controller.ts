import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { CreateTaskDto } from './dto/create-task.dto'
import { CompleteTaskDto } from './dto/complete-task.dto'
import { QueryTaskDto } from './dto/query-task.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('tasks')
export class TasksController {
  constructor(private service: TasksService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string; organizationId: string },
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.create(user.organizationId, user.id, dto)
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string; organizationId: string; role: string; teamId: string | null },
    @Query() query: QueryTaskDto,
  ) {
    return this.service.findAll(user.organizationId, query, user)
  }

  @Get('summary')
  getSummary(@CurrentUser() user: { id: string; organizationId: string }) {
    return this.service.getOverdueSummary(user.organizationId, user.id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateTaskDto>,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Patch(':id/complete')
  complete(
    @CurrentUser() user: { id: string; organizationId: string },
    @Param('id') id: string,
    @Body() dto: CompleteTaskDto,
  ) {
    return this.service.complete(user.organizationId, id, user.id, dto)
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.cancel(user.organizationId, id)
  }
}
