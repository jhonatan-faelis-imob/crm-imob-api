import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { CreateMessageTemplateDto } from './dto/create-message-template.dto'
import { LeadMessageDto, QueryMessageTemplateDto, RenderTemplateDto } from './dto/message-actions.dto'
import { UpdateMessageTemplateDto } from './dto/update-message-template.dto'
import { MessageTemplatesService } from './message-templates.service'

type AuthenticatedUser = { id: string; organizationId: string; role: string; teamId: string | null }

@Controller('message-templates')
export class MessageTemplatesController {
  constructor(private service: MessageTemplatesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryMessageTemplateDto) {
    return this.service.findAll(user.organizationId, user.id, query.type)
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMessageTemplateDto) {
    return this.service.create(user.organizationId, user, dto)
  }

  @Post('render-free')
  renderFree(@CurrentUser() user: AuthenticatedUser, @Body() dto: LeadMessageDto) {
    return this.service.renderFree(user.organizationId, user, dto)
  }

  @Post('send-log-free')
  sendLogFree(@CurrentUser() user: AuthenticatedUser, @Body() dto: LeadMessageDto) {
    return this.service.sendLogFree(user.organizationId, user, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMessageTemplateDto,
  ) {
    return this.service.update(user.organizationId, id, user, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.remove(user.organizationId, id, user)
  }

  @Post(':id/render')
  render(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RenderTemplateDto) {
    return this.service.render(user.organizationId, id, user, dto.leadId)
  }

  @Post(':id/send-log')
  sendLog(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: LeadMessageDto) {
    return this.service.sendLog(user.organizationId, id, user, dto)
  }
}
