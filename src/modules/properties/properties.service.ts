import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreatePropertyDto } from './dto/create-property.dto'
import { PortalReadinessDto } from './dto/portal.dto'
import { QueryPropertyDto } from './dto/query-property.dto'
import { UpdatePropertyDto } from './dto/update-property.dto'
import { findPropertyType } from './portal.config'
import { evaluatePortalReadiness, type PortalReadinessInput } from './portal.readiness'

const OWNER_SELECT = { select: { id: true, name: true, avatarUrl: true } } as const
const SELLER_SELECT = { select: { id: true, name: true, phone: true } } as const

/** Resumo dos portais, calculado em memória (fotos ainda não existem: não contam) */
function withPortal<T extends PortalReadinessInput & { kind: string }>(property: T) {
  if (property.kind !== 'revenda') return { ...property, portal: null }
  const { ready, missing } = evaluatePortalReadiness(property, null)
  return { ...property, portal: { ready, missingCount: missing.length } }
}

/** Junta o salvo com o que veio no PATCH, ignorando campos ausentes */
function merge<T extends object>(current: T, changes: object): T {
  const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined))
  return { ...current, ...defined }
}

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  async create(organizationId: string, ownerId: string, dto: CreatePropertyDto) {
    await this.assertSellerLead(organizationId, dto.sellerLeadId)
    const data = this.withTypeDefaults(dto)
    if (dto.publishToPortals === true) this.assertPublishable(dto.kind, data)

    return this.prisma.property.create({
      data: {
        ...data,
        organizationId,
        ownerId: dto.ownerId ?? ownerId,
      },
    })
  }

  async findAll(organizationId: string, query: QueryPropertyDto) {
    const {
      search,
      kind,
      city,
      propertyStatus,
      minPrice,
      maxPrice,
      publishToPortals,
      page = 1,
      limit = 20,
    } = query

    // Cada filtro é uma condição do AND: dois OR (busca e preço) não se sobrescrevem mais
    const and: Prisma.PropertyWhereInput[] = [{ organizationId, active: true }]

    if (search) {
      and.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { neighborhood: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (kind) and.push({ kind })
    if (city) and.push({ city: { contains: city, mode: 'insensitive' } })
    if (propertyStatus) and.push({ propertyStatus })
    if (publishToPortals) and.push({ publishToPortals: publishToPortals === 'true' })

    if (minPrice || maxPrice) {
      and.push({
        OR: [
          { price: { gte: minPrice ? Number(minPrice) : undefined, lte: maxPrice ? Number(maxPrice) : undefined } },
          { startingPrice: { gte: minPrice ? Number(minPrice) : undefined } },
        ],
      })
    }

    const where: Prisma.PropertyWhereInput = { AND: and }
    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take: limit,
        include: {
          owner: OWNER_SELECT,
          sellerLead: SELLER_SELECT,
          _count: { select: { leads: true, sales: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.property.count({ where }),
    ])

    return {
      data: data.map(withPortal),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async findById(organizationId: string, id: string) {
    const property = await this.prisma.property.findFirst({
      where: { id, organizationId },
      include: {
        owner: OWNER_SELECT,
        sellerLead: SELLER_SELECT,
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
    return withPortal(property)
  }

  async update(organizationId: string, id: string, dto: UpdatePropertyDto) {
    const current = await this.prisma.property.findFirst({ where: { id, organizationId } })
    if (!current) throw new NotFoundException('Imóvel não encontrado')

    await this.assertSellerLead(organizationId, dto.sellerLeadId)
    if (dto.publishToPortals === true) {
      const merged = merge(current, dto)
      this.assertPublishable(merged.kind, merged)
    }

    return this.prisma.property.update({ where: { id }, data: dto })
  }

  /** Avalia um rascunho do formulário sem gravar nada */
  readiness(draft: PortalReadinessDto) {
    return evaluatePortalReadiness(draft, null)
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
    try {
      return await this.prisma.leadProperty.create({ data: { leadId, propertyId, notes } })
    } catch (error) {
      // Vínculo repetido: a chave composta (leadId, propertyId) recusa
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Imóvel já vinculado a este lead')
      }
      throw error
    }
  }

  async removeLeadLink(propertyId: string, leadId: string) {
    return this.prisma.leadProperty.delete({
      where: { leadId_propertyId: { leadId, propertyId } },
    })
  }

  /** O proprietário precisa ser um lead da mesma organização */
  private async assertSellerLead(organizationId: string, sellerLeadId: string | null | undefined) {
    if (!sellerLeadId) return
    const lead = await this.prisma.lead.findFirst({ where: { id: sellerLeadId, organizationId }, select: { id: true } })
    if (!lead) throw new BadRequestException('Proprietário não encontrado nesta organização')
  }

  /** Publicar exige revenda completa (fotos ainda não contam) */
  private assertPublishable(kind: string, property: PortalReadinessInput) {
    if (kind !== 'revenda') throw new BadRequestException('Só imóveis de revenda podem ser publicados nos portais')
    const { ready, missing } = evaluatePortalReadiness(property, null)
    if (!ready) throw new BadRequestException({ message: 'Imóvel incompleto para os portais', missing })
  }

  /** Kitnet sem quartos informados vale 0 */
  private withTypeDefaults<T extends { propertyType?: string; bedrooms?: number }>(dto: T): T {
    const type = findPropertyType(dto.propertyType)
    if (type?.bedroomsDefault === null || type === undefined || dto.bedrooms !== undefined) return dto
    return { ...dto, bedrooms: type.bedroomsDefault }
  }
}
