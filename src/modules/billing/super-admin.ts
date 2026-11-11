import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { normalizeEmail } from '../../common/utils/email'

/** SUPER_ADMIN_EMAILS: lista separada por vírgula. Sem cargo no banco */
export function superAdminEmails(raw = process.env.SUPER_ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  )
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  return !!email && superAdminEmails().has(normalizeEmail(email))
}

/** Compara o e-mail do usuário autenticado com SUPER_ADMIN_EMAILS (lida a cada requisição) */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { email?: string } }>()
    if (!isSuperAdmin(request.user?.email)) throw new ForbiddenException('Acesso restrito ao administrador do sistema')
    return true
  }
}
