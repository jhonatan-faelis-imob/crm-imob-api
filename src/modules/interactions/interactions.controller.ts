import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { InteractionsService } from './interactions.service'
import { CreateInteractionDto } from './dto/create-interaction.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@Controller('interactions')
export class InteractionsController {
  constructor(private service: InteractionsService) {}

  @Post()
  create(
    @CurrentUser() user: { id: string; organizationId: string },
    @Body() dto: CreateInteractionDto,
  ) {
    return this.service.create(user.organizationId, user.id, dto)
  }

  @Get('lead/:leadId')
  findByLead(
    @CurrentUser() user: { organizationId: string },
    @Param('leadId') leadId: string,
  ) {
    return this.service.findByLead(user.organizationId, leadId)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: Partial<CreateInteractionDto>,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.remove(user.organizationId, id)
  }
}
