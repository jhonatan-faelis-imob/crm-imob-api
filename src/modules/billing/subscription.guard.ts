import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ALLOW_WHEN_BLOCKED_KEY } from '../../common/decorators/allow-when-blocked.decorator'
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator'
import { SubscriptionCache } from './subscription-cache'
import { isReadOnly } from './subscription-state'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const SUBSCRIPTION_BLOCKED = {
  statusCode: HttpStatus.PAYMENT_REQUIRED,
  code: 'SUBSCRIPTION_BLOCKED',
  message: 'Assinatura bloqueada. Fale com o suporte para reativar.',
} as const

type GuardRequest = { method: string; user?: { organizationId?: string } }

/**
 * Global, depois do JWT e dos cargos. Bloqueada ou cancelada: somente leitura (GET passa, escrita dá 402).
 * Teste vencido e atrasada passam; o aviso sai no GET /billing/me. Leitura nunca é bloqueada
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private cache: SubscriptionCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_BLOCKED_KEY, targets)) return true

    const request = context.switchToHttp().getRequest<GuardRequest>()
    if (READ_METHODS.has(request.method.toUpperCase())) return true
    const organizationId = request.user?.organizationId
    if (!organizationId) return true

    const snapshot = await this.cache.get(organizationId)
    if (snapshot && isReadOnly(snapshot.subscriptionStatus)) {
      throw new HttpException(SUBSCRIPTION_BLOCKED, HttpStatus.PAYMENT_REQUIRED)
    }
    return true
  }
}
