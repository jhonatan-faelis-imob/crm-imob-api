import { BadRequestException, type CanActivate, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizeEmail } from '../../common/utils/email'
import { formatPhone, normalizePhone } from '../../common/utils/phone'
import { SlidingWindowLimiter } from '../../common/utils/rate-limiter'
import { onlyDigits } from '../billing/document'
import { TRIAL_DAYS } from '../billing/plans.config'
import { OnboardingDto } from './dto/onboarding.dto'
import { UpdateMyOrganizationDto } from './dto/update-my-organization.dto'
import { seedFunnelStages } from './seed-funnel'

const DAY_MS = 24 * 60 * 60 * 1000

/** PUBLIC_SIGNUP_ENABLED=true liga o cadastro público; padrão desligado */
export function isPublicSignupEnabled(raw = process.env.PUBLIC_SIGNUP_ENABLED): boolean {
  return raw?.trim().toLowerCase() === 'true'
}

export const SIGNUP_DISABLED_MESSAGE = 'Cadastro disponível apenas por contato com o suporte'

/** Roda antes da validação do corpo: desligado dá 403 mesmo com corpo incompleto */
@Injectable()
export class PublicSignupGuard implements CanActivate {
  canActivate(): boolean {
    if (!isPublicSignupEnabled()) throw new ForbiddenException(SIGNUP_DISABLED_MESSAGE)
    return true
  }
}

@Injectable()
export class OrganizationsService {
  /** 5 cadastros por hora por IP (em memória, por réplica) */
  private readonly signupLimiter = new SlidingWindowLimiter(5, 60 * 60 * 1000)

  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      // Anotações internas e dados de cobrança ficam no painel /admin e no GET /billing/me (diretor)
      omit: { notes: true, billingName: true, billingDocument: true, billingEmail: true, billingPhone: true },
      include: {
        _count: { select: { users: true, leads: true } },
      },
    })
    if (!org) throw new NotFoundException('Organização não encontrada')
    return org
  }

  async update(id: string, dto: UpdateMyOrganizationDto) {
    return this.prisma.organization.update({ where: { id }, data: dto })
  }

  /** Cadastro público: plano Corretor, 1 usuário, em teste por TRIAL_DAYS dias */
  async onboarding(dto: OnboardingDto, ip: string, now = new Date()) {
    if (!isPublicSignupEnabled()) {
      throw new ForbiddenException(SIGNUP_DISABLED_MESSAGE)
    }
    if (!this.signupLimiter.hit(ip, now.getTime())) {
      throw new HttpException('Muitos cadastros a partir desta rede. Tente de novo em uma hora.', HttpStatus.TOO_MANY_REQUESTS)
    }

    const email = normalizeEmail(dto.email)
    const phoneDigits = normalizePhone(dto.phone)
    if (!phoneDigits) throw new BadRequestException('Telefone deve ter 10 ou 11 dígitos com DDD')
    const document = onlyDigits(dto.document)

    const [slugTaken, emailTaken, documentTaken] = await Promise.all([
      this.prisma.organization.findUnique({ where: { slug: dto.slug }, select: { id: true } }),
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }),
      // Um teste por CPF ou CNPJ
      this.prisma.organization.findFirst({ where: { billingDocument: document }, select: { id: true } }),
    ])
    if (documentTaken) throw new ConflictException('Já existe uma conta com este documento')
    if (slugTaken) throw new ConflictException('Slug já em uso — tente outro nome')
    if (emailTaken) throw new ConflictException('Email já cadastrado')

    const passwordHash = await bcrypt.hash(dto.password, 10)
    const phone = formatPhone(phoneDigits)

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.orgName,
          slug: dto.slug,
          plan: 'corretor',
          seats: 1,
          subscriptionStatus: 'teste',
          trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
          // Dados de cobrança já preenchidos para assinar depois; nada é criado no Asaas agora
          billingName: dto.orgName,
          billingDocument: document,
          billingEmail: email,
          billingPhone: phone,
        },
      })
      await seedFunnelStages(tx, org.id)
      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          name: dto.name,
          email,
          phone,
          passwordHash,
          role: 'diretor',
        },
      })
      await tx.billingEvent.create({
        data: { organizationId: org.id, kind: 'observacao', description: `Cadastro público: teste de ${TRIAL_DAYS} dias`, createdBy: email },
      })
      return { organization: org, user: { id: user.id, name: user.name, email: user.email } }
    })
  }
}
