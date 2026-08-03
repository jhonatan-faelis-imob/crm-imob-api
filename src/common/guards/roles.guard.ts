import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'

const HIERARCHY: Record<string, number> = {
  diretor: 5,
  gerente: 4,
  coordenador: 3,
  corretor: 2,
  administrativo: 1,
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requiredRoles) return true

    const { user } = context.switchToHttp().getRequest()
    const userLevel = HIERARCHY[user.role] ?? 0
    const hasRole = requiredRoles.some(role => userLevel >= (HIERARCHY[role] ?? 0))

    if (!hasRole) throw new ForbiddenException('Acesso negado para este perfil')
    return true
  }
}
