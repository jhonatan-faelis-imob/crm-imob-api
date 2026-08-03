import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateTaskDto } from './dto/create-task.dto'
import { CompleteTaskDto } from './dto/complete-task.dto'
import { QueryTaskDto } from './dto/query-task.dto'

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    organizationId: string,
    createdBy: string,
    dto: CreateTaskDto,
  ) {
    const assignedTo = dto.assignedTo ?? createdBy

    return this.prisma.task.create({
      data: {
        ...dto,
        organizationId,
        createdBy,
        assignedTo,
        dueDate: new Date(dto.dueDate),
      },
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        lead: { select: { id: true, name: true } },
        parentTask: { select: { id: true, title: true } },
      },
    })
  }

  async findAll(
    organizationId: string,
    query: QueryTaskDto,
    requestingUser: { id: string; role: string; teamId: string | null },
  ) {
    const { search, status, type, priority, assignedTo, leadId, period, page = 1, limit = 20 } = query

    const where: Record<string, unknown> = { organizationId }

    // Corretor vê apenas suas tarefas
    if (requestingUser.role === 'corretor') {
      where.assignedTo = requestingUser.id
    } else if (assignedTo) {
      where.assignedTo = assignedTo
    }

    if (search) where.title = { contains: search, mode: 'insensitive' }
    if (status) where.status = status
    if (type) where.type = type
    if (priority) where.priority = priority
    if (leadId) where.leadId = leadId

    // Filtros de período
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

    if (period === 'today') {
      where.dueDate = { gte: startOfDay, lt: endOfDay }
    } else if (period === 'overdue') {
      where.dueDate = { lt: startOfDay }
      where.status = 'pendente'
    } else if (period === 'week') {
      const endOfWeek = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000)
      where.dueDate = { gte: startOfDay, lt: endOfWeek }
    } else if (period === 'month') {
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      where.dueDate = { gte: startOfDay, lt: endOfMonth }
    }

    const skip = (page - 1) * limit

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        include: {
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          lead: { select: { id: true, name: true } },
          parentTask: { select: { id: true, title: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.task.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  async complete(
    organizationId: string,
    id: string,
    userId: string,
    dto: CompleteTaskDto,
  ) {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId } })
    if (!task) throw new NotFoundException('Tarefa não encontrada')

    // Marcar como concluída
    const completed = await this.prisma.task.update({
      where: { id },
      data: {
        status: 'concluida',
        completedAt: new Date(),
        completionNotes: dto.completionNotes,
      },
    })

    // Criar próxima tarefa se solicitado
    const nextTask = dto.createNextTask && dto.nextTaskTitle && dto.nextTaskDueDate
      ? await this.prisma.task.create({
          data: {
            organizationId,
            leadId: task.leadId,
            assignedTo: task.assignedTo,
            createdBy: userId,
            parentTaskId: id,
            title: dto.nextTaskTitle,
            type: dto.nextTaskType ?? task.type,
            priority: task.priority,
            dueDate: new Date(dto.nextTaskDueDate),
            hasNextTask: false,
          },
          include: {
            assignee: { select: { id: true, name: true, avatarUrl: true } },
            lead: { select: { id: true, name: true } },
          },
        })
      : null

    return { completed, nextTask }
  }

  async cancel(organizationId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId } })
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    return this.prisma.task.update({ where: { id }, data: { status: 'cancelada' } })
  }

  async update(organizationId: string, id: string, dto: Partial<CreateTaskDto>) {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId } })
    if (!task) throw new NotFoundException('Tarefa não encontrada')
    return this.prisma.task.update({
      where: { id },
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        lead: { select: { id: true, name: true } },
      },
    })
  }

  async getOverdueSummary(organizationId: string, userId: string) {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const [overdue, dueToday, pending] = await Promise.all([
      this.prisma.task.count({
        where: { organizationId, assignedTo: userId, status: 'pendente', dueDate: { lt: startOfDay } },
      }),
      this.prisma.task.count({
        where: {
          organizationId, assignedTo: userId, status: 'pendente',
          dueDate: { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86400000) },
        },
      }),
      this.prisma.task.count({
        where: { organizationId, assignedTo: userId, status: 'pendente' },
      }),
    ])

    return { overdue, dueToday, pending }
  }
}
