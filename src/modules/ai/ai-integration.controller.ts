import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { SaveAiKeyDto, UpdateAiSettingsDto } from '../integrations/dto/integrations.dto'
import { AiSettingsService } from './ai-settings.service'

type AiUser = { id: string; name: string; organizationId: string }

// Configuração de IA na tela de Integrações. A chave própria entra pelo PUT e nunca volta (só a máscara)
@Controller('integrations/ai')
@Roles('gerente')
export class AiIntegrationController {
  constructor(private settings: AiSettingsService) {}

  @Get()
  get(@CurrentUser() user: AiUser) {
    return this.settings.getView(user.organizationId)
  }

  @Patch()
  update(@CurrentUser() user: AiUser, @Body() dto: UpdateAiSettingsDto) {
    return this.settings.update(user, dto)
  }

  @Put('key')
  saveKey(@CurrentUser() user: AiUser, @Body() dto: SaveAiKeyDto) {
    return this.settings.saveKey(user, dto.apiKey)
  }

  @Delete('key')
  removeKey(@CurrentUser() user: AiUser) {
    return this.settings.removeKey(user)
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() user: AiUser) {
    return this.settings.test(user)
  }
}
