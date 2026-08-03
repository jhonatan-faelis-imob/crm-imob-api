import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { organization: { select: { id: true, name: true, slug: true, plan: true } } },
    })

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciais inválidas')
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciais inválidas')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      teamId: user.teamId,
    }

    const accessToken = this.jwtService.sign(payload)
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('jwt.refreshExpiresIn'),
    })

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        organizationId: user.organizationId,
        teamId: user.teamId,
        organization: user.organization,
      },
    }
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken)
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, organizationId: true, teamId: true, active: true },
      })

      if (!user || !user.active) throw new UnauthorizedException()

      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
        teamId: user.teamId,
      }

      return {
        accessToken: this.jwtService.sign(newPayload),
        refreshToken: this.jwtService.sign(newPayload, {
          expiresIn: this.configService.get('jwt.refreshExpiresIn'),
        }),
      }
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado')
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, role: true,
        avatarUrl: true, phone: true, creci: true,
        organizationId: true, teamId: true,
        organization: { select: { id: true, name: true, slug: true, plan: true } },
        team: { select: { id: true, name: true } },
      },
    })
    if (!user) throw new UnauthorizedException()
    return user
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
  }
}
