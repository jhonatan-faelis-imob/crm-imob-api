import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreatePropertyDto } from './dto/create-property.dto'
import { QueryPropertyDto } from './dto/query-property.dto'

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, ownerId: string, dto: CreatePropertyDto) {
    return this.prisma.property.create({
      data: {
        ...dto,
        organizationId,
        ownerId: dto.ownerId ?? ownerId,
      },
    })
  }

  async findAll(organizationId: string, query: QueryPropertyDto) {
    const { search, kind, city, propertyStatus, minPrice, maxPrice, page = 1, limit = 20 } = query

    const where: Record<string, unknown> = { organizationId, active: true }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { neighborhood: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (kind) where.kind = kind
    if (city) where.city = { contains: city, mode: 'insensitive' }
    if (propertyStatus) where.propertyStatus = propertyStatus

    if (minPrice || maxPrice) {
      where.OR = [
        { price: { gte: minPrice ? Number(minPrice) : undefined, lte: maxPrice ? Number(maxPrice) : undefined } },
        { startingPrice: { gte: minPrice ? Number(minPrice) : undefined } },
      ]
    }

    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: { select: { id: true, name: true, avatarUrl: true } },
          _count: { select: { leads: true, sales: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.property.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async findById(organizationId: string, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, organizationId },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        leads: {
          include: { lead: { select: { id: true, name: true, phone: true, status: true } } },
        },
        sales: {
          orderBy: { soldAt: 'desc' },
          take: 10,
        },
        _count: { select: { leads: true, sales: true } },
      },
    })
    if (!property) throw new NotFoundException('Imóvel não encontrado')
    return property
  }

  async update(organizationId: string, id: string, dto: Partial<CreatePropertyDto>) {
    await this.prisma.property.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.property.update({ where: { id }, data: dto })
  }

  async markAsSold(organizationId: string, id: string) {
    await this.prisma.property.findFirstOrThrow({ where: { id, organizationId, kind: 'revenda' } })
    return this.prisma.property.update({ where: { id }, data: { sold: true, active: false } })
  }

  async deactivate(organizationId: string, id: string) {
    await this.prisma.property.findFirstOrThrow({ where: { id, organizationId } })
    return this.prisma.property.update({ where: { id }, data: { active: false } })
  }

  async findByIncomeMatch(organizationId: string, income: number) {
    return this.prisma.property.findMany({
      where: {
        organizationId,
        active: true,
        sold: false,
        minIncome: { lte: income },
        maxIncome: { gte: income },
      },
      orderBy: { startingPrice: 'asc' },
      take: 10,
    })
  }

  async addLeadLink(organizationId: string, propertyId: string, leadId: string, notes?: string) {
    await this.prisma.property.findFirstOrThrow({ where: { id: propertyId, organizationId } })
    return this.prisma.leadProperty.create({ data: { leadId, propertyId, notes } })
  }

  async removeLeadLink(propertyId: string, leadId: string) {
    return this.prisma.leadProperty.delete({
      where: { leadId_propertyId: { leadId, propertyId } },
    })
  }
}
