import { Body, Controller, Headers, HttpCode, InternalServerErrorException, Post, UnauthorizedException } from '@nestjs/common'
import { Public } from '../../../common/decorators/public.decorator'
import { AsaasWebhookService } from './asaas-webhook.service'
import type { AsaasWebhookEvent } from './asaas.types'

// Webhook do Asaas. Autenticidade: token no cabeçalho asaas-access-token (a documentação não prevê assinatura da
// requisição). Responde 200 depois de gravar; 500 em erro inesperado para o Asaas repetir

@Controller('public/webhooks')
export class AsaasWebhookController {
  constructor(private service: AsaasWebhookService) {}

  @Public()
  @Post('asaas')
  @HttpCode(200)
  async receive(@Headers('asaas-access-token') token: string | undefined, @Body() body: AsaasWebhookEvent) {
    // Sem detalhes: não ajuda quem está testando tokens
    if (!this.service.isAuthentic(token)) throw new UnauthorizedException()
    try {
      const result = await this.service.handle(body)
      return { received: true, duplicate: result.duplicate }
    } catch {
      throw new InternalServerErrorException('Erro ao processar o evento')
    }
  }
}
