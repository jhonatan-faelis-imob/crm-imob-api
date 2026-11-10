import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizeEmail } from '../../common/utils/email'
import { formatPhone, normalizePhone } from '../../common/utils/phone'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import type { JwtPayload } from './interfaces/jwt-payload.interface'
import { PasswordAttempts } from './password-attempts'
import { isSessionCurrent, sessionStamp } from './session-stamp'

type TokenUser = {
  id: string
  email: string
  role: string
  organizationId: string
  teamId: string | null
  updatedAt: Date
}

const TOKEN_USER_SELECT = {
  id: true, email: true, role: true, organizationId: true, teamId: true, updatedAt: true, active: true,
} satisfies Prisma.UserSelect

const PROFILE_SELECT = {
  id: true, name: true, email: true, phone: true, creci: true, avatarUrl: true,
  role: true, teamId: true, createdAt: true,
  team: { select: { name: true } },
  organization: { select: { name: true } },
} satisfies Prisma.UserSelect

type ProfileRow = Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>

function toProfile({ team, organization, ...user }: ProfileRow) {
  return { ...user, teamName: team?.name ?? null, organizationName: organization.name }
}

/** Motivo da recusa do login, só para o log (o usuário recebe sempre a mesma mensagem) */
type LoginFailure = 'usuario_nao_encontrado' | 'inativo' | 'senha_incorreta'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private passwordAttempts: PasswordAttempts,
  ) {}

  /** Tokens com o carimbo da sessão (pwd); ver session-stamp.ts */
  issueTokens(user: TokenUser) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      teamId: user.teamId,
      pwd: sessionStamp(user.updatedAt),
    }
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        expiresIn: this.configService.get('jwt.refreshExpiresIn'),
      }),
    }
  }

  private rejectLogin(reason: LoginFailure, email: string): never {
    // Só o motivo e o e-mail normalizado. Nunca a senha
    this.logger.warn(`Login recusado: motivo=${reason} email=${email}`)
    throw new UnauthorizedException('Credenciais inválidas')
  }

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email)
    // insensitive: acha também contas antigas gravadas com maiúsculas
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { organization: { select: { id: true, name: true, slug: true, plan: true } } },
    })

    if (!user) this.rejectLogin('usuario_nao_encontrado', email)
    if (!user.active) this.rejectLogin('inativo', email)
    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash)
    if (!passwordMatch) this.rejectLogin('senha_incorreta', email)

    // Mantém o updatedAt: um login novo não pode derrubar as sessões dos outros aparelhos
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), updatedAt: user.updatedAt },
    })

    return {
      ...this.issueTokens(user),
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
    let payload: JwtPayload
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken)
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado')
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: TOKEN_USER_SELECT })
    if (!user || !user.active || !isSessionCurrent(payload.pwd, user.updatedAt)) {
      throw new UnauthorizedException('Refresh token inválido ou expirado')
    }
    return this.issueTokens(user)
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

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT })
    if (!user) throw new UnauthorizedException()
    return toProfile(user)
  }

  /**
   * Nome, telefone e CRECI. Muda o updatedAt, então as outras sessões caem;
   * quem editou recebe tokens novos na resposta
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {}
    if (dto.name !== undefined) {
      const name = dto.name.trim()
      if (!name) throw new BadRequestException('Informe seu nome')
      data.name = name
    }
    if (dto.phone !== undefined) {
      if (dto.phone.trim() === '') data.phone = null
      else {
        const digits = normalizePhone(dto.phone)
        if (!digits) throw new BadRequestException('Telefone deve ter 10 ou 11 dígitos com DDD')
        data.phone = formatPhone(digits)
      }
    }
    if (dto.creci !== undefined) data.creci = dto.creci.trim() || null
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada para atualizar')

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { ...PROFILE_SELECT, ...TOKEN_USER_SELECT },
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { updatedAt, active, organizationId, ...profile } = updated
    return { user: toProfile(profile), ...this.issueTokens(updated) }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    this.passwordAttempts.hit(userId)

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
    if (!user) throw new UnauthorizedException()
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Senha atual incorreta')
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual')
    }

    // O updatedAt novo derruba as outras sessões; esta recebe tokens novos
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.hashPassword(dto.newPassword) },
      select: TOKEN_USER_SELECT,
    })
    return this.issueTokens(updated)
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
  }
}
