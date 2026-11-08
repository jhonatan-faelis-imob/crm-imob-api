import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CreatePropertyDto } from './dto/create-property.dto'
import { PortalReadinessDto } from './dto/portal.dto'
import { QueryPropertyDto } from './dto/query-property.dto'
import { UpdatePropertyDto } from './dto/update-property.dto'
import { findPropertyType } from './portal.config'
import { evaluatePortalReadiness, type PortalReadinessInput } from './portal.readiness'
import {
  MAX_CODE_ATTEMPTS,
  duplicateCodeMessage,
  formatPropertyCode,
  normalizePropertyCode,
} from './property-code'

/** Criação com código automático: até 3 tentativas se duas criações simultâneas disputarem o mesmo número */
const MAX_CREATE_ATTEMPTS = 3

export const CODE_CHANGED_WARNING =
  'O código mudou. Se for usado como identificador nos portais, o anúncio pode ser tratado como novo.'

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

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
    const { code: rawCode, ...fields } = dto
    await this.assertSellerLead(organizationId, dto.sellerLeadId)
    const data = this.withTypeDefaults(fields)
    if (dto.publishToPortals === true) this.assertPublishable(dto.kind, data)

    // Digitado: normaliza e confere antes, para a mensagem dizer qual imóvel já usa o código
    const manualCode = normalizePropertyCode(rawCode)
    if (manualCode) await this.assertCodeFree(organizationId, manualCode)

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const code = manualCode ?? (await this.nextFreeCode(tx, organizationId))
          return tx.property.create({
            data: { ...data, code, organizationId, ownerId: dto.ownerId ?? ownerId },
          })
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        // Outro cadastro pegou o mesmo código entre a conferência e a gravação
        if (manualCode) {
          await this.assertCodeFree(organizationId, manualCode)
          throw new ConflictException(`Código "${manualCode}" já está em uso`)
        }
        if (attempt >= MAX_CREATE_ATTEMPTS) {
          throw new ConflictException('Não foi possível gerar o código do imóvel. Tente de novo.')
        }
      }
    }
  }

  /** Dica do próximo código automático (não reserva nada) */
  async nextCodeHint(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { propertyCodeSeq: true },
    })
    const sequence = organization?.propertyCodeSeq ?? 0
    const candidates = Array.from({ length: MAX_CODE_ATTEMPTS }, (_, index) => formatPropertyCode(sequence + index + 1))
    const taken = await this.prisma.property.findMany({
      where: { organizationId, code: { in: candidates } },
      select: { code: true },
    })
    const takenCodes = new Set(taken.map((item) => item.code))
    return { hint: candidates.find((code) => !takenCodes.has(code)) ?? formatPropertyCode(sequence + 1) }
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
          { code: { contains: search.trim(), mode: 'insensitive' } },
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
    const include = {
      owner: OWNER_SELECT,
      sellerLead: SELLER_SELECT,
      _count: { select: { leads: true, sales: true } },
    } as const

    const [rows, total] = await Promise.all([
      this.prisma.property.findMany({ where, skip, take: limit, include, orderBy: { createdAt: 'desc' } }),
      this.prisma.property.count({ where }),
    ])

    // Texto igual a um código (CS-01, cs-01): esse imóvel vem primeiro, respeitando os outros filtros
    let data = rows
    const exactCode = search?.trim().toUpperCase()
    if (exactCode && page === 1) {
      const exact = await this.prisma.property.findFirst({ where: { AND: [...and, { code: exactCode }] }, include })
      if (exact) data = [exact, ...rows.filter((row) => row.id !== exact.id)].slice(0, limit)
    }

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

    const { code: rawCode, ...fields } = dto
    // Ausente ou vazio mantém o atual: o código nunca volta a ficar vazio
    const normalizedCode = rawCode === undefined ? null : normalizePropertyCode(rawCode)
    const newCode = normalizedCode !== null && normalizedCode !== current.code ? normalizedCode : null
    if (newCode) await this.assertCodeFree(organizationId, newCode, id)

    await this.assertSellerLead(organizationId, dto.sellerLeadId)
    if (dto.publishToPortals === true) {
      const merged = merge(current, fields)
      this.assertPublishable(merged.kind, merged)
    }

    const updated = await this.prisma.property
      .update({ where: { id }, data: newCode ? { ...fields, code: newCode } : fields })
      .catch(async (error: unknown) => {
        // Outro imóvel pegou o código entre a conferência e a gravação
        if (newCode && isUniqueViolation(error)) {
          await this.assertCodeFree(organizationId, newCode, id)
          throw new ConflictException(`Código "${newCode}" já está em uso`)
        }
        throw error
      })

    // Trocar o código de um anúncio marcado para os portais pode virar "anúncio novo" lá
    const published = updated.publishToPortals || current.publishToPortals
    if (newCode && current.code !== null && published) return { ...updated, warning: CODE_CHANGED_WARNING }
    return updated
  }

  /** 409 se outro imóvel da organização já usa o código (exceptId = o próprio imóvel, na edição) */
  private async assertCodeFree(organizationId: string, code: string, exceptId?: string) {
    const holder = await this.prisma.property.findFirst({
      where: { organizationId, code, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { title: true },
    })
    if (holder) throw new ConflictException(duplicateCodeMessage(code, holder.title))
  }

  /** Próximo número livre: incremento atômico da sequência, pulando códigos digitados à mão */
  private async nextFreeCode(tx: Prisma.TransactionClient, organizationId: string) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const { propertyCodeSeq } = await tx.organization.update({
        where: { id: organizationId },
        data: { propertyCodeSeq: { increment: 1 } },
        select: { propertyCodeSeq: true },
      })
      const code = formatPropertyCode(propertyCodeSeq)
      const taken = await tx.property.findFirst({ where: { organizationId, code }, select: { id: true } })
      if (!taken) return code
    }
    throw new ConflictException('Não foi possível gerar o código do imóvel. Tente de novo.')
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
