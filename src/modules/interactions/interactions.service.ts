import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateInteractionDto } from './dto/create-interaction.dto'

@Injectable()
export class InteractionsService {
  constructor(private prisma: PrismaService) {}

  async create(
    organizationId: string,
    userId: string,
    dto: CreateInteractionDto,
  ) {
    // Verifica se o lead pertence à organização
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, organizationId },
    })
    if (!lead) throw new NotFoundException('Lead não encontrado')

    const interaction = await this.prisma.interaction.create({
      data: {
        ...dto,
        organizationId,
        userId,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    })

    // Atualizar lastContactAt do lead
    await this.prisma.lead.update({
      where: { id: dto.leadId },
      data: { lastContactAt: new Date() },
    })

    return interaction
  }

  async findByLead(organizationId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } })
    if (!lead) throw new NotFoundException('Lead não encontrado')

    return this.prisma.interaction.findMany({
      where: { leadId, organizationId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { occurredAt: 'desc' },
    })
  }

  async update(organizationId: string, id: string, dto: Partial<CreateInteractionDto>) {
    const interaction = await this.prisma.interaction.findFirst({
      where: { id, organizationId },
    })
    if (!interaction) throw new NotFoundException('Interação não encontrada')

    return this.prisma.interaction.update({
      where: { id },
      data: { notes: dto.notes, type: dto.type },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    })
  }

  async remove(organizationId: string, id: string) {
    const interaction = await this.prisma.interaction.findFirst({
      where: { id, organizationId },
    })
    if (!interaction) throw new NotFoundException('Interação não encontrada')
    return this.prisma.interaction.delete({ where: { id } })
  }
}
