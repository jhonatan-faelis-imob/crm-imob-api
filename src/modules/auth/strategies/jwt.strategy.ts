import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../../prisma/prisma.service'
import { JwtPayload } from '../interfaces/jwt-payload.interface'
import { isSessionCurrent } from '../session-stamp'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
    })
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        teamId: true,
        active: true,
        updatedAt: true,
      },
    })

    if (!user || !user.active) {
      throw new UnauthorizedException('Usuário não encontrado ou inativo')
    }
    // Senha ou dados do usuário mudaram depois da emissão: token antigo deixa de valer
    if (!isSessionCurrent(payload.pwd, user.updatedAt)) {
      throw new UnauthorizedException('Sessão encerrada. Entre novamente')
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { updatedAt, ...current } = user
    return current
  }
}
