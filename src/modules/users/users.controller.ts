import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'

@Controller('users')
export class UsersController {
  constructor(private service: UsersService) {}

  @Post()
  @Roles('coordenador')
  create(
    @CurrentUser() user: { organizationId: string; role: string },
    @Body() dto: CreateUserDto,
  ) {
    return this.service.create(user.organizationId, dto, user.role)
  }

  @Get()
  findAll(@CurrentUser() user: { organizationId: string; role: string; teamId: string | null }) {
    return this.service.findAll(user.organizationId, user)
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
  update(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.service.update(user.organizationId, id, dto)
  }

  @Patch(':id/reset-password')
  @Roles('gerente')
  resetPassword(
    @CurrentUser() user: { organizationId: string },
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.service.resetPassword(user.organizationId, id, password)
  }
}
