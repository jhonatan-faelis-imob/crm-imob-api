import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboard(organizationId: string, userId: string, role: string, teamId: string | null) {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const threeDaysAgo = new Date(startOfDay.getTime() - 3 * 24 * 60 * 60 * 1000)

    const baseWhere: Record<string, unknown> = { organizationId }
    if (role === 'corretor') baseWhere.ownerId = userId
    else if (role === 'coordenador' && teamId) baseWhere.teamId = teamId

    const [
      totalLeads,
      leadsWithoutContact,
      overdueTasks,
      pendingTasks,
      monthlySales,
      funnelCounts,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { ...baseWhere, active: true } }),

      this.prisma.lead.count({
        where: {
          ...baseWhere,
          active: true,
          status: { notIn: ['ganho', 'perdido'] },
          OR: [
            { lastContactAt: { lt: threeDaysAgo } },
            { lastContactAt: null },
          ],
        },
      }),

      this.prisma.task.count({
        where: {
          organizationId,
          ...(role === 'corretor' ? { assignedTo: userId } : {}),
          status: 'pendente',
          dueDate: { lt: startOfDay },
        },
      }),

      this.prisma.task.count({
        where: {
          organizationId,
          ...(role === 'corretor' ? { assignedTo: userId } : {}),
          status: 'pendente',
        },
      }),

      this.prisma.sale.aggregate({
        where: {
          organizationId,
          ...(role === 'corretor' ? { brokerId: userId } : {}),
          soldAt: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { saleValue: true },
        _count: { id: true },
      }),

      this.prisma.lead.groupBy({
        by: ['funnelStageId'],
        where: { ...baseWhere, active: true },
        _count: { id: true },
      }),
    ])

    return {
      totalLeads,
      leadsWithoutContact,
      overdueTasks,
      pendingTasks,
      monthlyVgv: monthlySales._sum.saleValue ?? 0,
      monthlySalesCount: monthlySales._count.id,
      funnelCounts,
    }
  }

  async getSalesByPeriod(
    organizationId: string,
    startDate: string,
    endDate: string,
    groupBy: 'day' | 'month' = 'month',
  ) {
    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId,
        soldAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: { soldAt: true, saleValue: true },
      orderBy: { soldAt: 'asc' },
    })

    // Agrupar por mês ou dia
    const grouped: Record<string, { vgv: number; count: number }> = {}
    for (const sale of sales) {
      const key = groupBy === 'month'
        ? `${sale.soldAt.getFullYear()}-${String(sale.soldAt.getMonth() + 1).padStart(2, '0')}`
        : sale.soldAt.toISOString().split('T')[0]

      if (!grouped[key]) grouped[key] = { vgv: 0, count: 0 }
      grouped[key].vgv += Number(sale.saleValue)
      grouped[key].count += 1
    }

    return Object.entries(grouped).map(([period, data]) => ({ period, ...data }))
  }

  async getBrokerRanking(
    organizationId: string,
    startDate: string,
    endDate: string,
  ) {
    const sales = await this.prisma.sale.groupBy({
      by: ['brokerId'],
      where: {
        organizationId,
        soldAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      _sum: { saleValue: true, commissionValue: true },
      _count: { id: true },
      orderBy: { _sum: { saleValue: 'desc' } },
      take: 10,
    })

    const brokerIds = sales.map(s => s.brokerId).filter(Boolean) as string[]
    const brokers = await this.prisma.user.findMany({
      where: { id: { in: brokerIds } },
      select: { id: true, name: true, avatarUrl: true, team: { select: { name: true } } },
    })

    return sales.map((sale, index) => {
      const broker = brokers.find(b => b.id === sale.brokerId)
      return {
        position: index + 1,
        broker,
        vgv: sale._sum.saleValue ?? 0,
        commission: sale._sum.commissionValue ?? 0,
        units: sale._count.id,
      }
    })
  }

  async getSalesByProperty(organizationId: string, startDate: string, endDate: string) {
    return this.prisma.sale.groupBy({
      by: ['propertyId'],
      where: {
        organizationId,
        soldAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      _sum: { saleValue: true },
      _count: { id: true },
      orderBy: { _sum: { saleValue: 'desc' } },
    })
  }

  async getLeadsBySource(organizationId: string) {
    return this.prisma.lead.groupBy({
      by: ['source'],
      where: { organizationId, active: true },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    })
  }

  async getSalesByTeam(organizationId: string, startDate: string, endDate: string) {
    return this.prisma.sale.groupBy({
      by: ['teamId'],
      where: {
        organizationId,
        soldAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      _sum: { saleValue: true },
      _count: { id: true },
      orderBy: { _sum: { saleValue: 'desc' } },
    })
  }

  async getSalesByIncomeBracket(organizationId: string, startDate: string, endDate: string) {
    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId,
        soldAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      select: { lead: { select: { income: true } } },
    })

    const brackets = [
      { label: 'Até R$2k', max: 2000 },
      { label: 'R$2k–4k', max: 4000 },
      { label: 'R$4k–8k', max: 8000 },
      { label: 'R$8k–15k', max: 15000 },
      { label: 'Acima R$15k', max: Infinity },
    ]
    const counts = brackets.map((bracket) => ({ label: bracket.label, count: 0 }))

    for (const sale of sales) {
      const income = sale.lead?.income ? Number(sale.lead.income) : null
      if (income === null) continue
      const bracketIndex = brackets.findIndex((bracket) => income <= bracket.max)
      counts[bracketIndex === -1 ? counts.length - 1 : bracketIndex].count += 1
    }

    return counts
  }
}
