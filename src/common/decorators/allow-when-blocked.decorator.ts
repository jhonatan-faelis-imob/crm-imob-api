import { SetMetadata } from '@nestjs/common'

export const ALLOW_WHEN_BLOCKED_KEY = 'allowWhenBlocked'

/**
 * Rota que funciona mesmo com a assinatura bloqueada: /auth, /health, /billing/me, painel /admin
 * e POSTs que só leem (renderizar mensagem, calcular simulação). Ver SubscriptionGuard
 */
export const AllowWhenBlocked = () => SetMetadata(ALLOW_WHEN_BLOCKED_KEY, true)
