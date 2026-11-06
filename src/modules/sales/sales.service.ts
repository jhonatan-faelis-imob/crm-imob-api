import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { HIERARCHY } from '../../common/guards/roles.guard'
import { PrismaService } from '../../prisma/prisma.service'
import { GoalsService } from '../goals/goals.service'
import { CreateSaleDto } from './dto/create-sale.dto'
import { UpdateSaleStatusDto } from './dto/update-sale-status.dto'
import { QuerySaleDto } from './dto/query-sale.dto'

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private goalsService: GoalsService,
  ) {}

  async create(
    organizationId: string,
    requestingUser: { id: string; teamId: string | null },
    dto: CreateSaleDto,
  ) {
    const lead = dto.leadId
      ? await this.prisma.lead.findFirst({
          where: { id: dto.leadId, organizationId },
          select: { ownerId: true, teamId: true },
        })
      : null
    if (dto.leadId && !lead) throw new NotFoundException('Lead não encontrado')

    if (dto.leadId) {
      const existingSale = await this.prisma.sale.findFirst({
        where: { organizationId, leadId: dto.leadId, status: { not: 'cancelado' } },
        select: { id: true },
      })
      if (existingSale) throw new ConflictException('Este lead já possui uma venda registrada')
    }

    // A venda conta para o dono do lead, não para quem registrou: gerente ou coordenador
    // regularizando um lead não pode entrar no ranking no lugar do corretor
    const brokerId = dto.brokerId ?? lead?.ownerId ?? requestingUser.id
    const teamId = dto.teamId ?? lead?.teamId ?? requestingUser.teamId ?? undefined
    const commissionValue = dto.commissionPct && dto.saleValue
      ? (dto.saleValue * dto.commissionPct) / 100
      : undefined

    const sale = await this.prisma.sale.create({
      data: {
        ...dto,
        organizationId,
        brokerId,
        teamId,
        commissionValue,
        soldAt: new Date(dto.soldAt),
      },
      include: {
        lead: { select: { id: true, name: true } },
        property: { select: { id: true, title: true, kind: true } },
        broker: { select: { id: true, name: true, avatarUrl: true } },
        team: { select: { id: true, name: true } },
      },
    })

    // Se for revenda, marcar imóvel como vendido
    if (dto.propertyId) {
      const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId } })
      if (property?.kind === 'revenda') {
        await this.prisma.property.update({
          where: { id: dto.propertyId },
          data: { sold: true, active: false },
        })
      }
    }

    // Atualizar lead para ganho
    if (dto.leadId) {
      await this.prisma.lead.update({
        where: { id: dto.leadId },
        data: { status: 'ganho' },
      })
    }

    // Criar entrada no histórico de status
    await this.prisma.saleStatusHistory.create({
      data: {
        organizationId,
        saleId: sale.id,
        newStatus: 'pendente',
        changedBy: requestingUser.id,
      },
    })

    await this.goalsService.recalculateForSale(organizationId, sale)

    return sale
  }

  async findAll(
    organizationId: string,
    query: QuerySaleDto,
    requestingUser: { id: string; role: string; teamId: string | null },
  ) {
    const { brokerId, teamId, propertyId, status, startDate, endDate, page = 1, limit = 20 } = query
    const where: Record<string, unknown> = { organizationId }

    if (requestingUser.role === 'corretor') where.brokerId = requestingUser.id
    else if (requestingUser.role === 'coordenador') where.teamId = requestingUser.teamId
    else {
      if (brokerId) where.brokerId = brokerId
      if (teamId) where.teamId = teamId
    }

    if (propertyId) where.propertyId = propertyId
    if (status) where.status = status
    if (startDate || endDate) {
      where.soldAt = {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      }
    }

    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        include: {
          lead: { select: { id: true, name: true } },
          property: { select: { id: true, title: true, kind: true } },
          broker: { select: { id: true, name: true, avatarUrl: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: { soldAt: 'desc' },
      }),
      this.prisma.sale.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async findById(organizationId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, organizationId },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        property: true,
        broker: { select: { id: true, name: true, avatarUrl: true } },
        team: { select: { id: true, name: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!sale) throw new NotFoundException('Venda não encontrada')
    return sale
  }

  async updateStatus(
    organizationId: string,
    id: string,
    requestingUser: { id: string; role: string },
    dto: UpdateSaleStatusDto,
  ) {
    const sale = await this.prisma.sale.findFirst({ where: { id, organizationId } })
    if (!sale) throw new NotFoundException('Venda não encontrada')

    const isManager = (HIERARCHY[requestingUser.role] ?? 0) >= HIERARCHY.coordenador
    const isOwnCancellation =
      requestingUser.role === 'corretor' &&
      dto.status === 'cancelado' &&
      sale.brokerId === requestingUser.id
    if (!isManager && !isOwnCancellation) {
      throw new ForbiddenException('Corretor só pode cancelar a própria venda')
    }

    const [updated] = await Promise.all([
      this.prisma.sale.update({ where: { id }, data: { status: dto.status } }),
      this.prisma.saleStatusHistory.create({
        data: {
          organizationId,
          saleId: id,
          previousStatus: sale.status,
          newStatus: dto.status,
          changedBy: requestingUser.id,
          reason: dto.reason,
        },
      }),
    ])

    const wasCancelled = sale.status === 'cancelado'
    const isCancelled = dto.status === 'cancelado'
    if (wasCancelled !== isCancelled) {
      await this.goalsService.recalculateForSale(organizationId, updated)
    }

    return updated
  }

  // Venda cancelada não conta: o lead continua em Ganho sem nada somando nas metas
  async getPendingLeads(
    organizationId: string,
    requestingUser: { role: string; teamId: string | null },
  ) {
    return this.prisma.lead.findMany({
      where: {
        organizationId,
        active: true,
        ...(requestingUser.role === 'coordenador' && requestingUser.teamId
          ? { teamId: requestingUser.teamId }
          : {}),
        OR: [
          { status: 'ganho' },
          { funnelStage: { name: { equals: 'Ganho', mode: 'insensitive' } } },
        ],
        sales: { none: { status: { not: 'cancelado' } } },
      },
      select: {
        id: true,
        name: true,
        interestValue: true,
        funnelStageId: true,
        owner: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async getVgvSummary(organizationId: string, startDate?: string, endDate?: string) {
    const where: Record<string, unknown> = { organizationId, status: { not: 'cancelado' } }
    if (startDate || endDate) {
      where.soldAt = {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      }
    }

    const result = await this.prisma.sale.aggregate({
      where,
      _sum: { saleValue: true, commissionValue: true },
      _count: { id: true },
    })

    return {
      totalVgv: result._sum.saleValue ?? 0,
      totalCommission: result._sum.commissionValue ?? 0,
      totalSales: result._count.id,
    }
  }
}
