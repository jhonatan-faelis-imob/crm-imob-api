import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { LeadsService, type LeadAccessUser } from '../leads/leads.service'
import {
  MAX_ACTIVE_REQUIREMENTS,
  MAX_ITEMS_PER_LEAD,
  pendingDocumentsText,
  requirementApplies,
  statusDates,
  summarizeChecklist,
  type ChecklistLead,
} from './checklist-rules'
import { DEFAULT_REQUIREMENTS } from './default-requirements'
import {
  BulkChecklistDto,
  CreateChecklistItemDto,
  CreateRequirementDto,
  ReorderRequirementsDto,
  UpdateChecklistItemDto,
  UpdateRequirementDto,
} from './dto/document.dto'

const REQUIREMENT_ORDER: Prisma.DocumentRequirementOrderByWithRelationInput[] = [
  { orderIndex: 'asc' },
  { createdAt: 'asc' },
]
const ITEM_ORDER: Prisma.LeadChecklistItemOrderByWithRelationInput[] = [{ orderIndex: 'asc' }, { createdAt: 'asc' }]

type ChecklistLeadRef = ChecklistLead & { id: string }

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private leads: LeadsService,
  ) {}

  // ---------- Lista padrão da imobiliária ----------

  async listRequirements(organizationId: string) {
    await this.ensureDefaultRequirements(organizationId)
    return this.prisma.documentRequirement.findMany({ where: { organizationId }, orderBy: REQUIREMENT_ORDER })
  }

  async createRequirement(organizationId: string, dto: CreateRequirementDto) {
    if (dto.active !== false) await this.assertActiveLimit(organizationId)
    const { _max } = await this.prisma.documentRequirement.aggregate({
      where: { organizationId },
      _max: { orderIndex: true },
    })
    return this.prisma.documentRequirement.create({
      data: {
        ...dto,
        description: dto.description?.trim() || null,
        organizationId,
        orderIndex: (_max.orderIndex ?? -1) + 1,
      },
    })
  }

  async updateRequirement(organizationId: string, id: string, dto: UpdateRequirementDto) {
    const requirement = await this.findRequirement(organizationId, id)
    if (dto.active === true && !requirement.active) await this.assertActiveLimit(organizationId)
    return this.prisma.documentRequirement.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
      },
    })
  }

  // Exclusão lógica: os itens já copiados para os leads continuam como estão
  async removeRequirement(organizationId: string, id: string) {
    await this.findRequirement(organizationId, id)
    return this.prisma.documentRequirement.update({ where: { id }, data: { active: false } })
  }

  async reorderRequirements(organizationId: string, { orderedIds }: ReorderRequirementsDto) {
    if (new Set(orderedIds).size !== orderedIds.length) throw new BadRequestException('Há ids repetidos na lista')
    const found = await this.prisma.documentRequirement.count({ where: { organizationId, id: { in: orderedIds } } })
    if (found !== orderedIds.length) throw new BadRequestException('Há exigências que não são desta imobiliária')

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.documentRequirement.update({ where: { id }, data: { orderIndex: index } }),
      ),
    )
    return this.prisma.documentRequirement.findMany({ where: { organizationId }, orderBy: REQUIREMENT_ORDER })
  }

  // Conta também as inativas: esvaziar a lista de propósito não pode trazer os padrão de volta
  async ensureDefaultRequirements(organizationId: string) {
    if (await this.prisma.documentRequirement.count({ where: { organizationId } })) return

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${organizationId}`}))`
      if (await tx.documentRequirement.count({ where: { organizationId } })) return

      await tx.documentRequirement.createMany({
        data: DEFAULT_REQUIREMENTS.map((requirement, index) => ({
          organizationId,
          name: requirement.name,
          category: requirement.category,
          holder: requirement.holder,
          required: requirement.required ?? true,
          appliesWhen: requirement.appliesWhen ?? 'always',
          orderIndex: index,
        })),
      })
    })
  }

  // ---------- Checklist do lead ----------

  async getChecklist(user: LeadAccessUser, leadId: string) {
    const lead = await this.leads.assertLeadAccess(user, leadId)
    await this.ensureChecklist(user.organizationId, lead)
    return this.checklistResponse(user.organizationId, leadId)
  }

  async syncChecklist(user: LeadAccessUser, leadId: string) {
    const lead = await this.leads.assertLeadAccess(user, leadId)
    return { created: await this.addMissingItems(user.organizationId, lead) }
  }

  async addItem(user: LeadAccessUser, leadId: string, dto: CreateChecklistItemDto) {
    await this.leads.assertLeadAccess(user, leadId)
    const { _count, _max } = await this.prisma.leadChecklistItem.aggregate({
      where: { organizationId: user.organizationId, leadId },
      _count: true,
      _max: { orderIndex: true },
    })
    if (_count >= MAX_ITEMS_PER_LEAD) {
      throw new BadRequestException(`Cada cliente aceita no máximo ${MAX_ITEMS_PER_LEAD} documentos`)
    }

    return this.prisma.leadChecklistItem.create({
      data: {
        organizationId: user.organizationId,
        leadId,
        requirementId: null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        category: dto.category ?? 'outro',
        holder: dto.holder ?? 'titular',
        required: dto.required ?? true,
        orderIndex: (_max.orderIndex ?? -1) + 1,
        updatedBy: user.id,
      },
    })
  }

  async updateItem(user: LeadAccessUser, id: string, dto: UpdateChecklistItemDto) {
    const item = await this.findAccessibleItem(user, id)
    if (dto.name !== undefined && item.requirementId) {
      throw new BadRequestException('Só é possível renomear documentos avulsos')
    }

    return this.prisma.leadChecklistItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
        ...(dto.status && { status: dto.status, ...statusDates(dto.status, item, new Date()) }),
        updatedBy: user.id,
      },
    })
  }

  async bulkUpdate(user: LeadAccessUser, leadId: string, { ids, status }: BulkChecklistDto) {
    await this.leads.assertLeadAccess(user, leadId)
    const uniqueIds = Array.from(new Set(ids))
    const items = await this.prisma.leadChecklistItem.findMany({
      where: { organizationId: user.organizationId, leadId, id: { in: uniqueIds } },
      select: { id: true, receivedAt: true },
    })
    if (items.length !== uniqueIds.length) throw new BadRequestException('Há itens que não são deste cliente')

    const now = new Date()
    // As datas dependem do valor atual de cada item: dois grupos, com e sem receivedAt
    const withReceived = items.filter((item) => item.receivedAt).map((item) => item.id)
    const withoutReceived = items.filter((item) => !item.receivedAt).map((item) => item.id)
    const groups = [
      { ids: withReceived, dates: statusDates(status, { receivedAt: now }, now) },
      { ids: withoutReceived, dates: statusDates(status, { receivedAt: null }, now) },
    ].filter((group) => group.ids.length)

    await this.prisma.$transaction(
      groups.map((group) =>
        this.prisma.leadChecklistItem.updateMany({
          where: { organizationId: user.organizationId, leadId, id: { in: group.ids } },
          data: { status, ...group.dates, updatedBy: user.id },
        }),
      ),
    )
    return this.checklistResponse(user.organizationId, leadId)
  }

  async removeItem(user: LeadAccessUser, id: string) {
    const item = await this.findAccessibleItem(user, id)
    if (item.requirementId) throw new BadRequestException('Use ‘Dispensar’ para itens da lista padrão')
    await this.prisma.leadChecklistItem.delete({ where: { id } })
    return { id }
  }

  // Para {{documentos_pendentes}}: o acesso ao lead já foi validado por quem chama
  async pendingDocumentsForMessage(organizationId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId, active: true },
      select: { id: true, spouseName: true, maritalStatus: true, fgtsValue: true },
    })
    if (!lead) return ''
    await this.ensureChecklist(organizationId, lead)
    const items = await this.prisma.leadChecklistItem.findMany({
      where: { organizationId, leadId },
      orderBy: [{ holder: 'desc' }, ...ITEM_ORDER],
      select: { name: true, holder: true, required: true, status: true },
    })
    return pendingDocumentsText(items)
  }

  // Gera só na primeira abertura; depois, o que mudou no padrão entra pelo "Sincronizar"
  private async ensureChecklist(organizationId: string, lead: ChecklistLeadRef) {
    if (await this.prisma.leadChecklistItem.count({ where: { organizationId, leadId: lead.id } })) return
    await this.addMissingItems(organizationId, lead)
  }

  // Acrescenta o que falta (requirementId + holder), sem remover nem alterar nada.
  // skipDuplicates + @@unique seguram duas aberturas simultâneas
  private async addMissingItems(organizationId: string, lead: ChecklistLeadRef) {
    await this.ensureDefaultRequirements(organizationId)
    const [requirements, existing] = await Promise.all([
      this.prisma.documentRequirement.findMany({ where: { organizationId, active: true }, orderBy: REQUIREMENT_ORDER }),
      this.prisma.leadChecklistItem.findMany({
        where: { organizationId, leadId: lead.id, requirementId: { not: null } },
        select: { requirementId: true, holder: true },
      }),
    ])
    const existingKeys = new Set(existing.map((item) => `${item.requirementId}:${item.holder}`))

    const data = requirements
      .filter((requirement) => requirementApplies(requirement, lead))
      .filter((requirement) => !existingKeys.has(`${requirement.id}:${requirement.holder}`))
      .map((requirement) => ({
        organizationId,
        leadId: lead.id,
        requirementId: requirement.id,
        name: requirement.name,
        description: requirement.description,
        category: requirement.category,
        holder: requirement.holder,
        required: requirement.required,
        orderIndex: requirement.orderIndex,
      }))
    if (!data.length) return 0

    const { count } = await this.prisma.leadChecklistItem.createMany({ data, skipDuplicates: true })
    return count
  }

  private async checklistResponse(organizationId: string, leadId: string) {
    const items = await this.prisma.leadChecklistItem.findMany({
      where: { organizationId, leadId },
      orderBy: ITEM_ORDER,
    })
    return { items, summary: summarizeChecklist(items) }
  }

  private async findAccessibleItem(user: LeadAccessUser, id: string) {
    const item = await this.prisma.leadChecklistItem.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { lead: { select: { ownerId: true, teamId: true } } },
    })
    if (!item) throw new NotFoundException('Documento não encontrado')
    this.leads.assertCanView(item.lead, user)
    return item
  }

  private async findRequirement(organizationId: string, id: string) {
    const requirement = await this.prisma.documentRequirement.findFirst({ where: { id, organizationId } })
    if (!requirement) throw new NotFoundException('Exigência não encontrada')
    return requirement
  }

  private async assertActiveLimit(organizationId: string) {
    const active = await this.prisma.documentRequirement.count({ where: { organizationId, active: true } })
    if (active >= MAX_ACTIVE_REQUIREMENTS) {
      throw new BadRequestException(`A lista aceita no máximo ${MAX_ACTIVE_REQUIREMENTS} documentos ativos`)
    }
  }
}
