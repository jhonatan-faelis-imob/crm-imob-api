import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../auth/auth.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

const ROLE_HIERARCHY: Record<string, number> = {
  diretor: 5, gerente: 4, coordenador: 3, corretor: 2, administrativo: 1,
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  async create(organizationId: string, dto: CreateUserDto, requestingUserRole: string) {
    // Não pode criar usuário com role maior que a própria
    if ((ROLE_HIERARCHY[dto.role] ?? 0) >= (ROLE_HIERARCHY[requestingUserRole] ?? 0)) {
      throw new ForbiddenException('Não é possível criar usuário com perfil igual ou superior ao seu')
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('Email já cadastrado')

    const passwordHash = await this.authService.hashPassword(dto.password)
    const { password, ...rest } = dto

    return this.prisma.user.create({
      data: { ...rest, passwordHash, organizationId },
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, creci: true, avatarUrl: true,
        teamId: true, active: true, createdAt: true,
      },
    })
  }

  async findAll(organizationId: string, requestingUser: { role: string; teamId: string | null }) {
    // Coordenador vê apenas membros da sua equipe
    const where: Record<string, unknown> = { organizationId }
    if (requestingUser.role === 'coordenador' && requestingUser.teamId) {
      where.teamId = requestingUser.teamId
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, creci: true, avatarUrl: true,
        teamId: true, active: true, lastLogin: true, createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
  }

  async findById(organizationId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, creci: true, avatarUrl: true,
        teamId: true, active: true, lastLogin: true, createdAt: true,
        team: { select: { id: true, name: true } },
      },
    })
    if (!user) throw new NotFoundException('Usuário não encontrado')
    return user
  }

  async update(organizationId: string, id: string, dto: UpdateUserDto) {
    await this.findById(organizationId, id)
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, creci: true, avatarUrl: true,
        teamId: true, active: true,
      },
    })
  }

  async resetPassword(organizationId: string, id: string, newPassword: string) {
    await this.findById(organizationId, id)
    const passwordHash = await this.authService.hashPassword(newPassword)
    return this.prisma.user.update({ where: { id }, data: { passwordHash } })
  }
}
