import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { HIERARCHY } from '../../common/guards/roles.guard'
import { primaryFrontendUrl } from '../../common/utils/cors'
import { PrismaService } from '../../prisma/prisma.service'
import { InteractionsService } from '../interactions/interactions.service'
import { LeadsService } from '../leads/leads.service'
import { CreatePropertyShareDto, MarkShareSentDto } from './dto/property-share.dto'
import {
  DEFAULT_EXPIRATION_DAYS,
  MARK_SENT_DEDUP_MS,
  PUBLIC_PROPERTY_SELECT,
  buildPublicShare,
  generateShareToken,
  isBotUserAgent,
  shareStatus,
  shareUrl,
  type PublicShareBroker,
} from './public-share'

export interface ShareUser {
  id: string
  organizationId: string
  role: string
  teamId: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function isManager(user: ShareUser) {
  return (HIERARCHY[user.role] ?? 0) >= HIERARCHY.gerente
}

@Injectable()
export class PropertySharesService {
  private readonly logger = new Logger(PropertySharesService.name)

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private leads: LeadsService,
    private interactions: InteractionsService,
  ) {}

  /** Base do link. FRONTEND_URL precisa estar definido em produção */
  private url(token: string) {
    // FRONTEND_URL pode ser uma lista (CORS): o link usa o primeiro endereço
    const frontendUrl = primaryFrontendUrl(this.config.get<string>('FRONTEND_URL'))
    if (!frontendUrl) this.logger.warn('FRONTEND_URL não definido: link gerado com http://localhost:3000')
    return shareUrl(frontendUrl ?? 'http://localhost:3000', token)
  }

  async create(user: ShareUser, dto: CreatePropertyShareDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, organizationId: user.organizationId, active: true },
      select: { id: true, sold: true, propertyStatus: true },
    })
    if (!property) throw new NotFoundException('Imóvel não encontrado')
    if (property.sold || property.propertyStatus === 'vendido') {
      throw new BadRequestException('Imóvel vendido não pode ser compartilhado')
    }
    // Mesma regra do detalhe do lead: corretor só o próprio, coordenador só a equipe
    if (dto.leadId) await this.leads.assertLeadAccess(user, dto.leadId)

    const now = new Date()
    const expiresAt = new Date(now.getTime() + (dto.expiresInDays ?? DEFAULT_EXPIRATION_DAYS) * DAY_MS)
    const showPrice = dto.showPrice ?? true
    const leadId = dto.leadId ?? null

    // Reaproveita o link ativo do mesmo trio (imóvel, lead ou geral, quem criou), renovando o prazo
    const existing = await this.prisma.propertyShare.findFirst({
      where: {
        organizationId: user.organizationId,
        propertyId: property.id,
        leadId,
        createdBy: user.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    })

    const share = existing
      ? await this.prisma.propertyShare.update({ where: { id: existing.id }, data: { expiresAt, showPrice } })
      : await this.prisma.propertyShare.create({
          data: {
            organizationId: user.organizationId,
            propertyId: property.id,
            leadId,
            createdBy: user.id,
            token: generateShareToken(),
            showPrice,
            expiresAt,
          },
        })

    return { id: share.id, token: share.token, url: this.url(share.token), expiresAt: share.expiresAt, showPrice: share.showPrice }
  }

  /** Links já enviados ou vistos. Abaixo de gerente, só os que o usuário criou */
  async list(user: ShareUser, propertyId: string) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, organizationId: user.organizationId },
      select: { id: true },
    })
    if (!property) throw new NotFoundException('Imóvel não encontrado')

    const shares = await this.prisma.propertyShare.findMany({
      where: {
        organizationId: user.organizationId,
        propertyId,
        OR: [{ sentAt: { not: null } }, { viewCount: { gt: 0 } }],
        ...(isManager(user) ? {} : { createdBy: user.id }),
      },
      include: { lead: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    const now = new Date()
    return shares.map((share) => ({
      id: share.id,
      leadId: share.leadId,
      leadName: share.lead?.name ?? null,
      sentAt: share.sentAt,
      viewCount: share.viewCount,
      firstViewedAt: share.firstViewedAt,
      lastViewedAt: share.lastViewedAt,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      status: shareStatus(share, now),
      url: this.url(share.token),
      createdBy: share.createdBy,
    }))
  }

  /** Só quem criou o link, ou gerente e acima */
  async revoke(user: ShareUser, id: string) {
    const share = await this.findOwnShare(user, id)
    if (share.revokedAt) return { id: share.id, revokedAt: share.revokedAt }
    const updated = await this.prisma.propertyShare.update({ where: { id }, data: { revokedAt: new Date() } })
    return { id: updated.id, revokedAt: updated.revokedAt }
  }

  async markSent(user: ShareUser, id: string, dto: MarkShareSentDto) {
    const share = await this.findOwnShare(user, id)
    if (shareStatus(share) !== 'ativo') throw new BadRequestException('Este link não está mais ativo')

    const now = new Date()
    const url = this.url(share.token)
    if (!share.sentAt) await this.prisma.propertyShare.update({ where: { id }, data: { sentAt: now } })

    let interactionCreated = false
    if (dto.channel === 'whatsapp' && share.leadId) {
      // Dois cliques seguidos não duplicam: procura a interação deste link nos últimos 2 minutos
      const recent = await this.prisma.interaction.findFirst({
        where: {
          organizationId: user.organizationId,
          leadId: share.leadId,
          type: 'whatsapp',
          notes: { contains: url },
          createdAt: { gte: new Date(now.getTime() - MARK_SENT_DEDUP_MS) },
        },
        select: { id: true },
      })
      if (!recent) {
        await this.interactions.create(user.organizationId, user.id, {
          leadId: share.leadId,
          type: 'whatsapp',
          notes: `Imóvel enviado: ${share.property.title} (${url})`,
        })
        interactionCreated = true
      }
    }

    let linked = false
    if (dto.linkToLead && share.leadId) {
      try {
        await this.prisma.leadProperty.create({ data: { leadId: share.leadId, propertyId: share.propertyId } })
        linked = true
      } catch (error) {
        // Já vinculado: tudo certo
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
        linked = true
      }
    }

    return { sentAt: share.sentAt ?? now, interactionCreated, linked }
  }

  // ---------------- Público (sem login) ----------------

  async getPublic(token: string) {
    const share = await this.prisma.propertyShare.findUnique({
      where: { token },
      select: {
        showPrice: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
        organizationId: true,
        organization: { select: { name: true } },
        property: { select: PUBLIC_PROPERTY_SELECT },
      },
    })
    // Inexistente e revogado têm a mesma resposta: não revela se o token existiu
    if (!share || share.revokedAt) throw new NotFoundException('Link inválido')
    if (shareStatus(share) === 'expirado') throw new GoneException('Este link expirou')

    return buildPublicShare({
      property: share.property,
      showPrice: share.showPrice,
      broker: await this.broker(share.organizationId, share.createdBy),
      organizationName: share.organization.name,
      expiresAt: share.expiresAt,
    })
  }

  /** Conta a visita: ignora robôs (prévia do WhatsApp etc.) e links expirados ou revogados */
  async recordView(token: string, userAgent: string | undefined) {
    if (isBotUserAgent(userAgent)) return
    const share = await this.prisma.propertyShare.findUnique({
      where: { token },
      select: { id: true, revokedAt: true, expiresAt: true },
    })
    if (!share || shareStatus(share) !== 'ativo') return

    const now = new Date()
    // firstViewedAt só uma vez, mesmo com duas visitas ao mesmo tempo
    await this.prisma.propertyShare.updateMany({ where: { id: share.id, firstViewedAt: null }, data: { firstViewedAt: now } })
    await this.prisma.propertyShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    })
  }

  private async broker(organizationId: string, userId: string | null): Promise<PublicShareBroker | null> {
    if (!userId) return null
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { name: true, creci: true, phone: true, avatarUrl: true },
    })
    if (!user) return null
    return {
      name: user.name,
      creci: user.creci?.trim() || null,
      phone: user.phone?.trim() || null,
      avatarUrl: user.avatarUrl || null,
    }
  }

  private async findOwnShare(user: ShareUser, id: string) {
    const share = await this.prisma.propertyShare.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { property: { select: { title: true } } },
    })
    if (!share) throw new NotFoundException('Link não encontrado')
    if (share.createdBy !== user.id && !isManager(user)) throw new ForbiddenException('Só quem criou o link pode alterá-lo')
    return share
  }
}
