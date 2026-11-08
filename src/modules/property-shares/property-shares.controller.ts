import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { CreatePropertyShareDto, ListPropertySharesDto, MarkShareSentDto } from './dto/property-share.dto'
import { PropertySharesService, type ShareUser } from './property-shares.service'

// Qualquer perfil; tudo filtrado pela organização do usuário
@Controller('property-shares')
export class PropertySharesController {
  constructor(private service: PropertySharesService) {}

  @Post()
  create(@CurrentUser() user: ShareUser, @Body() dto: CreatePropertyShareDto) {
    return this.service.create(user, dto)
  }

  @Get()
  list(@CurrentUser() user: ShareUser, @Query() query: ListPropertySharesDto) {
    return this.service.list(user, query.propertyId)
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: ShareUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.revoke(user, id)
  }

  @Post(':id/mark-sent')
  @HttpCode(200)
  markSent(@CurrentUser() user: ShareUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkShareSentDto) {
    return this.service.markSent(user, id, dto)
  }
}

// Sem login: a página /i/:token do cliente
@Public()
@Controller('public/shares')
export class PublicSharesController {
  constructor(private service: PropertySharesService) {}

  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getPublic(token)
  }

  @Post(':token/view')
  @HttpCode(204)
  async view(@Param('token') token: string, @Headers('user-agent') userAgent: string | undefined) {
    await this.service.recordView(token, userAgent)
  }
}
