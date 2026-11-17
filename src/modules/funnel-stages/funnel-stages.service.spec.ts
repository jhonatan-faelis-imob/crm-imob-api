import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { CadencesService } from '../cadences/cadences.service'
import { LeadsService } from '../leads/leads.service'
import { FunnelStagesService } from './funnel-stages.service'

// Etapas do funil: excluir com trava, mover leads, renomear (ganho e perdido), criar numa posição e reordenar

const ORG = 'org-1'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((part) => matches(row, part))
    const value = row[key] ?? null
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; not?: unknown; gte?: number; notIn?: unknown[] }
      if (c.in) return c.in.includes(value)
      if (c.notIn) return !c.notIn.includes(value)
      if (c.gte !== undefined) return typeof value === 'number' && value >= c.gte
      if ('not' in c) return value !== c.not
    }
    return value === condition
  })
}

function apply(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (value !== null && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] as number) + (value as { increment: number }).increment
    } else row[key] = value
  }
}

let seq = 0
function table(rows: Row[], prefix: string) {
  return {
    rows,
    findFirst: jest.fn(({ where }: { where?: Where }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(({ where, take, orderBy }: { where?: Where; take?: number; orderBy?: Record<string, 'asc'> } = {}) => {
      const found = rows.filter((row) => matches(row, where))
      const key = orderBy ? Object.keys(orderBy)[0] : undefined
      if (key === 'orderIndex') found.sort((a, b) => (a.orderIndex as number) - (b.orderIndex as number))
      // Cópias, como o Prisma devolve: mexer na linha depois não altera o que já foi lido
      return Promise.resolve(found.slice(0, take).map((row) => ({ ...row })))
    }),
    createManyAndReturn: jest.fn(({ data }: { data: Row[] }) => {
      const created = data.map((item) => ({ id: `${prefix}-${++seq}`, status: 'pendente', ...item }))
      rows.push(...created)
      return Promise.resolve(created)
    }),
    count: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)).length)),
    create: jest.fn(({ data }: { data: Row }) => {
      const row = { id: `${prefix}-${++seq}`, isDefault: false, ...data }
      rows.push(row)
      return Promise.resolve(row)
    }),
    update: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const row = rows.find((item) => matches(item, where))
      if (!row) return Promise.reject(new Error('not found'))
      apply(row, data)
      return Promise.resolve(row)
    }),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const found = rows.filter((row) => matches(row, where))
      found.forEach((row) => apply(row, data))
      return Promise.resolve({ count: found.length })
    }),
    deleteMany: jest.fn(({ where }: { where: Where }) => {
      const doomed = rows.filter((row) => matches(row, where))
      doomed.forEach((row) => rows.splice(rows.indexOf(row), 1))
      return Promise.resolve({ count: doomed.length })
    }),
    delete: jest.fn(({ where }: { where: Where }) => {
      const index = rows.findIndex((row) => matches(row, where))
      if (index >= 0) rows.splice(index, 1)
      return Promise.resolve({})
    }),
    groupBy: jest.fn(({ by, where }: { by: string[]; where?: Where }) => {
      const groups = new Map<unknown, number>()
      rows.filter((row) => matches(row, where)).forEach((row) => groups.set(row[by[0]], (groups.get(row[by[0]]) ?? 0) + 1))
      return Promise.resolve([...groups].map(([key, count]) => ({ [by[0]]: key, _count: { _all: count } })))
    }),
  }
}

const stage = (id: string, name: string, orderIndex: number, isDefault = false, organizationId = ORG): Row => ({
  id, name, orderIndex, isDefault, organizationId, color: '#6366f1',
})
const lead = (id: string, funnelStageId: string, extra: Row = {}): Row => ({
  id, name: `Lead ${id}`, organizationId: ORG, ownerId: 'corretor-1', funnelStageId, status: 'novo', active: true, ...extra,
})
const step = (id: string, funnelStageId: string): Row => ({
  id, organizationId: ORG, funnelStageId, title: 'Ligar para {{primeiro_nome}}', description: null, type: 'ligacao',
  priority: 'media', offsetDays: 1, dueTime: '09:00', skipWeekends: false, orderIndex: 0, active: true,
})

function setup(seed: { stages: Row[]; leads?: Row[]; steps?: Row[] }) {
  const tables = {
    funnelStage: table(seed.stages, 'st'),
    lead: table(seed.leads ?? [], 'ld'),
    stageCadenceStep: table(seed.steps ?? [], 'sp'),
    task: table([], 'tk'),
    leadStageHistory: table([], 'hs'),
  }
  const runTransaction = (arg: ((tx: typeof tables) => Promise<unknown>) | Promise<unknown>[]) =>
    typeof arg === 'function' ? arg(tables) : Promise.all(arg)
  const db = { ...tables, $transaction: runTransaction }
  const prisma = db as unknown as PrismaService
  const leads = new LeadsService(prisma, new CadencesService(prisma))
  return { ...tables, service: new FunnelStagesService(prisma, leads) }
}

const base = () => [
  stage('novo', 'Novo', 1, true),
  stage('ganho', 'Ganho', 2, true),
  stage('perdido', 'Perdido', 3, true),
  stage('custom', 'Visita técnica', 4),
]

// ---------------------------------------------------------------- excluir

describe('excluir etapa', () => {
  it('com leads ativos: 409 STAGE_HAS_LEADS com a contagem', async () => {
    const { service, funnelStage } = setup({ stages: base(), leads: [lead('1', 'custom'), lead('2', 'custom'), lead('3', 'custom', { active: false })] })
    const error = await service.remove(ORG, 'custom').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'STAGE_HAS_LEADS', count: 2, message: 'Esta etapa tem 2 leads. Mova-os antes de excluir.',
    })
    expect(funnelStage.rows.some((row) => row.id === 'custom')).toBe(true)
  })

  it('vazia: remove e leva os passos de cadência junto, informando quantos', async () => {
    const { service, funnelStage, stageCadenceStep } = setup({
      stages: base(),
      steps: [step('a', 'custom'), step('b', 'custom'), step('c', 'novo')],
    })
    await expect(service.remove(ORG, 'custom')).resolves.toEqual({ ok: true, removedCadenceSteps: 2 })
    expect(funnelStage.rows.some((row) => row.id === 'custom')).toBe(false)
    expect(stageCadenceStep.rows.map((row) => row.id)).toEqual(['c'])
  })

  it('etapa padrão: 403', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.remove(ORG, 'ganho')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('não deixa o funil com menos de 2 etapas', async () => {
    const { service, funnelStage } = setup({ stages: [stage('a', 'Novo', 1), stage('b', 'Visita', 2)] })
    const error = await service.remove(ORG, 'b').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'MIN_STAGES' })
    expect(funnelStage.rows).toHaveLength(2)
  })

  it('etapa de outra organização: 404', async () => {
    const { service } = setup({ stages: [...base(), stage('alheia', 'X', 1, false, 'org-2')] })
    await expect(service.remove(ORG, 'alheia')).rejects.toThrow('Etapa não encontrada')
  })
})

// ---------------------------------------------------------------- mover leads

describe('mover leads', () => {
  const seed = () => ({
    stages: base(),
    leads: [lead('1', 'custom'), lead('2', 'custom'), lead('3', 'custom', { active: false }), lead('4', 'novo')],
    steps: [step('p1', 'novo'), step('p2', 'novo')],
  })

  it('move os ativos, grava o histórico de cada um e cria as tarefas da etapa de destino', async () => {
    const { service, lead: leads, leadStageHistory, task } = setup(seed())
    const result = await service.moveLeads(ORG, 'custom', { toStageId: 'novo' }, 'gerente-1')

    expect(result).toEqual({ moved: 2, cadence: { created: 4, cancelled: 0 } })
    expect(leads.rows.map((row) => row.funnelStageId)).toEqual(['novo', 'novo', 'custom', 'novo'])
    expect(leadStageHistory.rows).toHaveLength(2)
    expect(leadStageHistory.rows[0]).toMatchObject({
      leadId: '1', fromStageId: 'custom', toStageId: 'novo', toStageName: 'novo', changedBy: 'gerente-1',
    })
    expect(task.rows).toHaveLength(4)
    expect(task.rows.every((row) => row.autoGenerated === true && row.cadenceStageId === 'novo')).toBe(true)
  })

  it('mover para a mesma etapa é rejeitado', async () => {
    const { service, lead: leads } = setup(seed())
    await expect(service.moveLeads(ORG, 'custom', { toStageId: 'custom' }, 'u')).rejects.toBeInstanceOf(BadRequestException)
    expect(leads.rows[0].funnelStageId).toBe('custom')
  })

  it('etapa de outra organização: 404 e nada se move', async () => {
    const { service, lead: leads } = setup({ ...seed(), stages: [...base(), stage('alheia', 'X', 1, false, 'org-2')] })
    await expect(service.moveLeads(ORG, 'custom', { toStageId: 'alheia' }, 'u')).rejects.toThrow('Etapa não encontrada')
    expect(leads.rows[0].funnelStageId).toBe('custom')
  })

  it('mais de 300 leads: 400 pedindo para mover por partes', async () => {
    const many = Array.from({ length: 301 }, (_, i) => lead(`m${i}`, 'custom'))
    const { service, lead: leads } = setup({ stages: base(), leads: many })
    const error = await service.moveLeads(ORG, 'custom', { toStageId: 'novo' }, 'u').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BadRequestException)
    expect((error as BadRequestException).message).toContain('por partes')
    expect(leads.rows.every((row) => row.funnelStageId === 'custom')).toBe(true)
  })

  it('etapa vazia: 0 movidos', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.moveLeads(ORG, 'custom', { toStageId: 'novo' }, 'u')).resolves.toEqual({
      moved: 0, cadence: { created: 0, cancelled: 0 },
    })
  })

  it('depois de mover, a etapa pode ser excluída', async () => {
    const { service } = setup({ ...seed() })
    await service.moveLeads(ORG, 'custom', { toStageId: 'novo' }, 'u')
    await expect(service.remove(ORG, 'custom')).resolves.toMatchObject({ ok: true })
  })
})

// ---------------------------------------------------------------- renomear

describe('renomear etapa', () => {
  it('Ganho para Fechado é bloqueado (STAGE_IS_TERMINAL); Perdido também', async () => {
    const { service, funnelStage } = setup({ stages: base() })
    for (const id of ['ganho', 'perdido']) {
      const error = await service.update(ORG, id, { name: 'Fechado' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'STAGE_IS_TERMINAL',
        message: 'Esta etapa controla o registro de vendas e de perdas. Renomeá-la quebraria esse fluxo.',
      })
    }
    expect(funnelStage.rows[1].name).toBe('Ganho')
  })

  it('mudar só a forma (GANHO) e a cor das etapas de desfecho é permitido', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.update(ORG, 'ganho', { name: 'GANHO' })).resolves.toMatchObject({ name: 'GANHO' })
    await expect(service.update(ORG, 'perdido', { color: '#111111' })).resolves.toMatchObject({ color: '#111111' })
  })

  it('etapa comum e etapa padrão (não desfecho) podem ser renomeadas', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.update(ORG, 'custom', { name: 'Visita' })).resolves.toMatchObject({ name: 'Visita' })
    await expect(service.update(ORG, 'novo', { name: 'Entrada', color: '#22c55e' })).resolves.toMatchObject({
      name: 'Entrada', color: '#22c55e', isDefault: true,
    })
  })

  it('nunca altera isDefault nem a posição, mesmo que venham no corpo', async () => {
    const { service } = setup({ stages: base() })
    const dto = { name: 'Visita', isDefault: true, orderIndex: 99 }
    await expect(service.update(ORG, 'custom', dto)).resolves.toMatchObject({ isDefault: false, orderIndex: 4 })
  })

  it('nome repetido (sem acento e sem maiúsculas) dá 409', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.update(ORG, 'custom', { name: 'novo' })).rejects.toBeInstanceOf(ConflictException)
  })
})

// ---------------------------------------------------------------- criar, reordenar e listar

describe('criar, reordenar e listar', () => {
  it('criar numa posição empurra as seguintes e nasce como não padrão', async () => {
    const { service, funnelStage } = setup({ stages: base() })
    const created = await service.create(ORG, { name: 'Proposta', color: '#f59e0b', orderIndex: 2 })
    expect(created).toMatchObject({ name: 'Proposta', orderIndex: 2, isDefault: false })
    const order = [...funnelStage.rows].sort((a, b) => (a.orderIndex as number) - (b.orderIndex as number)).map((row) => row.name)
    expect(order).toEqual(['Novo', 'Proposta', 'Ganho', 'Perdido', 'Visita técnica'])
  })

  it('criar com nome já usado dá 409', async () => {
    const { service } = setup({ stages: base() })
    await expect(service.create(ORG, { name: 'ganho', orderIndex: 1 })).rejects.toBeInstanceOf(ConflictException)
  })

  it('reordenar persiste; id de outra organização ou repetido é recusado', async () => {
    const { service, funnelStage } = setup({ stages: [...base(), stage('alheia', 'X', 1, false, 'org-2')] })
    const list = await service.reorder(ORG, [
      { id: 'custom', orderIndex: 1 }, { id: 'novo', orderIndex: 2 }, { id: 'ganho', orderIndex: 3 }, { id: 'perdido', orderIndex: 4 },
    ])
    expect(list.map((item) => item.id)).toEqual(['custom', 'novo', 'ganho', 'perdido'])
    expect(funnelStage.rows.find((row) => row.id === 'custom')?.orderIndex).toBe(1)

    await expect(service.reorder(ORG, [{ id: 'alheia', orderIndex: 1 }])).rejects.toBeInstanceOf(BadRequestException)
    await expect(service.reorder(ORG, [{ id: 'novo', orderIndex: 1 }, { id: 'novo', orderIndex: 2 }])).rejects.toBeInstanceOf(BadRequestException)
  })

  it('listar traz leadsCount (só ativos) e cadenceStepsCount sem consulta por etapa', async () => {
    const { service, lead: leads } = setup({
      stages: base(),
      leads: [lead('1', 'custom'), lead('2', 'custom'), lead('3', 'custom', { active: false }), lead('4', 'novo')],
      steps: [step('p', 'custom')],
    })
    const list = await service.findAll(ORG)
    expect(list.map((item) => [item.id, item.leadsCount, item.cadenceStepsCount])).toEqual([
      ['novo', 1, 0], ['ganho', 0, 0], ['perdido', 0, 0], ['custom', 2, 1],
    ])
    expect(leads.groupBy).toHaveBeenCalledTimes(1)
    expect(leads.findMany).not.toHaveBeenCalled()
  })
})
