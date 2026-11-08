import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { HIERARCHY } from '../../common/guards/roles.guard'
import { PrismaService } from '../../prisma/prisma.service'
import { DocumentsService } from '../documents/documents.service'
import { InteractionsService } from '../interactions/interactions.service'
import { LeadsService } from '../leads/leads.service'
import { DEFAULT_TEMPLATES } from './default-templates'
import { CreateMessageTemplateDto } from './dto/create-message-template.dto'
import { LeadMessageDto } from './dto/message-actions.dto'
import { UpdateMessageTemplateDto } from './dto/update-message-template.dto'
import { extractVariables, greeting, renderTemplate, truncateText } from './render-template'

type RequestingUser = { id: string; role: string; teamId: string | null }

const LOG_TEXT_LIMIT = 300
const DOCUMENTS_VARIABLE = /\{\{\s*documentos_pendentes\s*\}\}/

function isAtLeast(role: string, minimum: string) {
  return (HIERARCHY[role] ?? 0) >= HIERARCHY[minimum]
}

@Injectable()
export class MessageTemplatesService {
  constructor(
    private prisma: PrismaService,
    private interactions: InteractionsService,
    private leads: LeadsService,
    private documents: DocumentsService,
  ) {}

  async findAll(organizationId: string, userId: string, type?: string) {
    await this.ensureDefaults(organizationId)
    return this.prisma.messageTemplate.findMany({
      where: { organizationId, OR: [{ isPublic: true }, { userId }], ...(type && { type }) },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
    })
  }

  async create(organizationId: string, user: RequestingUser, dto: CreateMessageTemplateDto) {
    if (dto.isPublic) this.assertCanShare(user)

    return this.prisma.messageTemplate.create({
      data: {
        organizationId,
        userId: user.id,
        name: dto.name,
        type: dto.type ?? 'outro',
        content: dto.content,
        variables: extractVariables(dto.content),
        isPublic: dto.isPublic ?? false,
      },
    })
  }

  async update(organizationId: string, id: string, user: RequestingUser, dto: UpdateMessageTemplateDto) {
    const template = await this.findVisible(organizationId, id, user.id)
    this.assertCanManage(template, user, 'editar')
    if (dto.isPublic) this.assertCanShare(user)

    return this.prisma.messageTemplate.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.content !== undefined && { variables: extractVariables(dto.content) }),
        // Modelo padrão não tem dono: ao deixar de ser público, sumiria para todo mundo
        ...(dto.isPublic === false && { userId: template.userId ?? user.id }),
      },
    })
  }

  async remove(organizationId: string, id: string, user: RequestingUser) {
    const template = await this.findVisible(organizationId, id, user.id)
    this.assertCanManage(template, user, 'excluir')
    return this.prisma.messageTemplate.delete({ where: { id } })
  }

  async render(organizationId: string, id: string, user: RequestingUser, leadId: string) {
    const template = await this.findVisible(organizationId, id, user.id)
    return this.renderForLead(organizationId, user, leadId, template.content)
  }

  renderFree(organizationId: string, user: RequestingUser, { leadId, text }: LeadMessageDto) {
    return this.renderForLead(organizationId, user, leadId, text)
  }

  async sendLog(organizationId: string, id: string, user: RequestingUser, { leadId, text }: LeadMessageDto) {
    const template = await this.findVisible(organizationId, id, user.id)
    const interaction = await this.logMessage(organizationId, user, leadId, `modelo: ${template.name}`, text)
    await this.prisma.messageTemplate.update({ where: { id }, data: { usageCount: { increment: 1 } } })
    return interaction
  }

  sendLogFree(organizationId: string, user: RequestingUser, { leadId, text }: LeadMessageDto) {
    return this.logMessage(organizationId, user, leadId, 'mensagem livre', text)
  }

  private async logMessage(
    organizationId: string,
    user: RequestingUser,
    leadId: string,
    source: string,
    text: string,
  ) {
    await this.findAccessibleLead(organizationId, user, leadId)
    return this.interactions.create(organizationId, user.id, {
      leadId,
      type: 'whatsapp',
      notes: `Mensagem preparada (${source}): ${truncateText(text, LOG_TEXT_LIMIT)}`,
    })
  }

  private async renderForLead(organizationId: string, user: RequestingUser, leadId: string, content: string) {
    const [lead, sender] = await Promise.all([
      this.findAccessibleLead(organizationId, user, leadId),
      this.prisma.user.findFirst({
        where: { id: user.id, organizationId },
        select: { name: true, phone: true, organization: { select: { name: true } } },
      }),
    ])
    // Só quando o texto pede: senão qualquer mensagem criaria o checklist do lead
    const pendingDocuments = DOCUMENTS_VARIABLE.test(content)
      ? await this.documents.pendingDocumentsForMessage(organizationId, leadId)
      : undefined

    return renderTemplate(content, {
      nome: lead.name,
      primeiro_nome: lead.name.trim().split(/\s+/)[0],
      empreendimento: lead.properties[0]?.property.title,
      corretor: sender?.name,
      telefone_corretor: sender?.phone,
      imobiliaria: sender?.organization.name,
      saudacao: greeting(),
      // Vazio entra em missing, como {{empreendimento}} sem imóvel
      documentos_pendentes: pendingDocuments,
    })
  }

  private async findAccessibleLead(organizationId: string, user: RequestingUser, leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, organizationId, active: true },
      select: {
        name: true,
        ownerId: true,
        teamId: true,
        properties: {
          select: { property: { select: { title: true } } },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    })
    if (!lead) throw new NotFoundException('Lead não encontrado')
    this.leads.assertCanView(lead, user)
    return lead
  }

  // Modelo privado de outro usuário responde como se não existisse
  private async findVisible(organizationId: string, id: string, userId: string) {
    const template = await this.prisma.messageTemplate.findFirst({
      where: { id, organizationId, OR: [{ isPublic: true }, { userId }] },
    })
    if (!template) throw new NotFoundException('Modelo não encontrado')
    return template
  }

  private assertCanShare(user: RequestingUser) {
    if (!isAtLeast(user.role, 'coordenador')) {
      throw new ForbiddenException('Só coordenador ou superior pode compartilhar modelos')
    }
  }

  private assertCanManage(
    template: { isPublic: boolean; userId: string | null },
    user: RequestingUser,
    action: 'editar' | 'excluir',
  ) {
    const canManage = template.isPublic ? isAtLeast(user.role, 'gerente') : template.userId === user.id
    if (!canManage) throw new ForbiddenException(`Sem permissão para ${action} este modelo`)
  }

  private async ensureDefaults(organizationId: string) {
    if (await this.prisma.messageTemplate.count({ where: { organizationId } })) return

    await this.prisma.$transaction(async (tx) => {
      // Sem índice único, duas abertas simultâneas criariam os padrão em dobro
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`
      if (await tx.messageTemplate.count({ where: { organizationId } })) return

      await tx.messageTemplate.createMany({
        data: DEFAULT_TEMPLATES.map((template) => ({
          ...template,
          organizationId,
          userId: null,
          isPublic: true,
          variables: extractVariables(template.content),
        })),
      })
    })
  }
}
