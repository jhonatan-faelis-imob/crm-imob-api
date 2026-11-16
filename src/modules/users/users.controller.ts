import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { DeactivateUserDto } from './dto/deactivate-user.dto'
import { TransferPortfolioDto } from './dto/transfer-portfolio.dto'
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

  /** O que a pessoa tem hoje (leads, tarefas, imóveis, metas): o aviso antes de desativar */
  @Get(':id/portfolio')
  @Roles('coordenador')
  portfolio(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.portfolio(user, id)
  }

  @Patch(':id/deactivate')
  @Roles('coordenador')
  deactivate(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: DeactivateUserDto) {
    return this.service.deactivate(user, id, dto)
  }

  @Patch(':id/activate')
  @Roles('coordenador')
  activate(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.activate(user, id)
  }

  @Post(':id/transfer')
  @Roles('coordenador')
  transfer(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: TransferPortfolioDto) {
    return this.service.transfer(user, id, dto)
  }

  /** Exclusão definitiva: só quem não tem nada vinculado */
  @Delete(':id')
  @Roles('diretor')
  remove(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.remove(user, id)
  }

  @Patch(':id/reset-password')
  @Roles('gerente')
  resetPassword(@CurrentUser() user: Actor, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(user, id, dto)
  }
}
