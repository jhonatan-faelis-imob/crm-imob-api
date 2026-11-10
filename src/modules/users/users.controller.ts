import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { ListUsersQueryDto } from './dto/list-users.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import type { Actor } from './user-permissions'

@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  @Post()
  @Roles('coordenador')
  create(@CurrentUser() user: Actor, @Body() dto: CreateUserDto) {
    return this.service.create(user, dto)
  }

  @Get()
  findAll(@CurrentUser() user: Actor, @Query() query: ListUsersQueryDto) {
    return this.service.findAll(user, query)
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
  ) {
    return this.service.findById(user.organizationId, id)
  }

  @Patch(':id')
  @Roles('coordenador')
  update(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(user, id, dto)
  }

  @Patch(':id/reset-password')
  @Roles('gerente')
  resetPassword(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(user, id, dto)
  }
}
