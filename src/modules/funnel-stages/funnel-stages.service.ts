import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateFunnelStageDto } from './dto/create-funnel-stage.dto'

@Injectable()
export class FunnelStagesService {
  constructor(private prisma: PrismaService) {}

  async findAll(organizationId: string) {
    return this.prisma.funnelStage.findMany({
      where: { organizationId },
      orderBy: { orderIndex: 'asc' },
    })
  }

  async create(organizationId: string, dto: CreateFunnelStageDto) {
    return this.prisma.funnelStage.create({
      data: { ...dto, organizationId, isDefault: false },
    })
  }

  async update(organizationId: string, id: string, dto: Partial<CreateFunnelStageDto>) {
    const stage = await this.prisma.funnelStage.findFirst({ where: { id, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')
    return this.prisma.funnelStage.update({ where: { id }, data: dto })
  }

  async remove(organizationId: string, id: string) {
    const stage = await this.prisma.funnelStage.findFirst({ where: { id, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')
    if (stage.isDefault) throw new ForbiddenException('Etapas padrão não podem ser removidas')
    return this.prisma.funnelStage.delete({ where: { id } })
  }

  async reorder(organizationId: string, orders: { id: string; orderIndex: number }[]) {
    await Promise.all(
      orders.map(({ id, orderIndex }) =>
        this.prisma.funnelStage.updateMany({
          where: { id, organizationId },
          data: { orderIndex },
        })
      )
    )
    return this.findAll(organizationId)
  }
}
