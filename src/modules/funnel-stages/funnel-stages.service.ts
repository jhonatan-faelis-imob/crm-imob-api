import {
  BadRequestException, ConflictException, ForbiddenException, HttpStatus, Injectable, NotFoundException,
} from '@nestjs/common'
import { normalizeStageName } from '../../common/utils/stage'
import { PrismaService } from '../../prisma/prisma.service'
import { LeadsService } from '../leads/leads.service'
import { CreateFunnelStageDto, UpdateFunnelStageDto } from './dto/create-funnel-stage.dto'
import { MoveLeadsDto, StageOrderDto } from './dto/stage-actions.dto'

/** Etapas que a regra de venda e de perda usa pelo nome (ver statusForStage em leads.service.ts) */
const TERMINAL_NAMES = ['ganho', 'perdido']
export const MIN_STAGES = 2

export const TERMINAL_MESSAGE = 'Esta etapa controla o registro de vendas e de perdas. Renomeá-la quebraria esse fluxo.'

function conflict(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new ConflictException({ statusCode: HttpStatus.CONFLICT, error: 'Conflict', code, message, ...extra })
}

@Injectable()
export class FunnelStagesService {
  constructor(
    private prisma: PrismaService,
    private leads: LeadsService,
  ) {}

  /** Etapas em ordem, cada uma com leadsCount (leads ativos) e cadenceStepsCount, em duas consultas agrupadas */
  async findAll(organizationId: string) {
    const [stages, leadCounts, stepCounts] = await Promise.all([
      this.prisma.funnelStage.findMany({ where: { organizationId }, orderBy: { orderIndex: 'asc' } }),
      this.prisma.lead.groupBy({
        by: ['funnelStageId'],
        where: { organizationId, active: true, funnelStageId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.stageCadenceStep.groupBy({
        by: ['funnelStageId'],
        where: { organizationId },
        _count: { _all: true },
      }),
    ])
    const leadsByStage = new Map(leadCounts.map((row) => [row.funnelStageId, row._count._all]))
    const stepsByStage = new Map(stepCounts.map((row) => [row.funnelStageId, row._count._all]))
    return stages.map((stage) => ({
      ...stage,
      leadsCount: leadsByStage.get(stage.id) ?? 0,
      cadenceStepsCount: stepsByStage.get(stage.id) ?? 0,
    }))
  }

  /** Duas etapas com o mesmo nome (sem acento e sem maiúsculas) confundiriam a regra de ganho e perda */
  private async assertNameFree(organizationId: string, name: string, exceptId?: string) {
    const wanted = normalizeStageName(name)
    const stages = await this.prisma.funnelStage.findMany({ where: { organizationId }, select: { id: true, name: true } })
    if (stages.some((stage) => stage.id !== exceptId && normalizeStageName(stage.name) === wanted)) {
      throw new ConflictException('Já existe uma etapa com esse nome')
    }
  }

  async create(organizationId: string, dto: CreateFunnelStageDto) {
    await this.assertNameFree(organizationId, dto.name)
    return this.prisma.$transaction(async (tx) => {
      // Abre espaço na posição pedida: quem estava ali (e depois) desce uma casa
      await tx.funnelStage.updateMany({
        where: { organizationId, orderIndex: { gte: dto.orderIndex } },
        data: { orderIndex: { increment: 1 } },
      })
      return tx.funnelStage.create({
        data: { name: dto.name, color: dto.color, orderIndex: dto.orderIndex, organizationId, isDefault: false },
      })
    })
  }

  /** Nome e cor, inclusive nas padrão. isDefault e posição não mudam aqui */
  async update(organizationId: string, id: string, dto: UpdateFunnelStageDto) {
    const stage = await this.prisma.funnelStage.findFirst({ where: { id, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')

    const data: UpdateFunnelStageDto = {}
    if (dto.color !== undefined) data.color = dto.color
    if (dto.name !== undefined && dto.name !== stage.name) {
      // Ganho e Perdido são lidas pelo nome: só podem mudar de forma (maiúsculas, acento)
      if (TERMINAL_NAMES.includes(normalizeStageName(stage.name)) && normalizeStageName(dto.name) !== normalizeStageName(stage.name)) {
        throw conflict('STAGE_IS_TERMINAL', TERMINAL_MESSAGE)
      }
      await this.assertNameFree(organizationId, dto.name, id)
      data.name = dto.name
    }
    if (Object.keys(data).length === 0) return stage
    return this.prisma.funnelStage.update({ where: { id }, data })
  }

  /**
   * Exclui só etapa não padrão, sem leads ativos e que não deixe a organização com menos de 2.
   * Os passos de cadência dela saem junto, na mesma transação
   */
  async remove(organizationId: string, id: string) {
    const stage = await this.prisma.funnelStage.findFirst({ where: { id, organizationId } })
    if (!stage) throw new NotFoundException('Etapa não encontrada')
    if (stage.isDefault) throw new ForbiddenException('Etapas padrão não podem ser removidas')

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.lead.count({ where: { organizationId, funnelStageId: id, active: true } })
      if (count > 0) {
        throw conflict('STAGE_HAS_LEADS', `Esta etapa tem ${count} ${count === 1 ? 'lead' : 'leads'}. Mova-os antes de excluir.`, { count })
      }
      const total = await tx.funnelStage.count({ where: { organizationId } })
      if (total <= MIN_STAGES) {
        throw conflict('MIN_STAGES', `O funil precisa ter ao menos ${MIN_STAGES} etapas.`)
      }
      const steps = await tx.stageCadenceStep.deleteMany({ where: { organizationId, funnelStageId: id } })
      await tx.funnelStage.delete({ where: { id } })
      return { ok: true, removedCadenceSteps: steps.count }
    })
  }

  /** Move todos os leads ativos da etapa para outra (histórico e cadência de destino, como no updateStage) */
  async moveLeads(organizationId: string, id: string, dto: MoveLeadsDto, changedBy: string) {
    return this.leads.moveAllToStage(organizationId, id, dto.toStageId, changedBy)
  }

  async reorder(organizationId: string, orders: StageOrderDto[]) {
    const ids = orders.map((order) => order.id)
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Etapa repetida na lista')
    const found = await this.prisma.funnelStage.count({ where: { organizationId, id: { in: ids } } })
    if (found !== ids.length) throw new BadRequestException('Alguma etapa não pertence a esta organização')

    await this.prisma.$transaction(
      orders.map(({ id, orderIndex }) =>
        this.prisma.funnelStage.updateMany({ where: { id, organizationId }, data: { orderIndex } }),
      ),
    )
    return this.findAll(organizationId)
  }
}
