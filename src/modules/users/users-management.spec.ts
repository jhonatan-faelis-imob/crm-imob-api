import { ConfigService } from '@nestjs/config'
import { ConflictException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuthService } from '../auth/auth.service'
import { JwtStrategy } from '../auth/strategies/jwt.strategy'
import { canManageUser, ROLES, type Actor, type Role } from './user-permissions'
import { UsersService } from './users.service'

// Editar, desativar, reativar, transferir carteira e excluir usuários, com um banco em memória

const ORG = 'org-1'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Where[]).some((part) => matches(row, part))
    const value = row[key] ?? null
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; not?: unknown; notIn?: unknown[]; equals?: string }
      if (c.in) return c.in.includes(value)
      if (c.notIn) return !c.notIn.includes(value)
      if ('not' in c) return value !== c.not
      if ('equals' in c) return typeof value === 'string' && value.toLowerCase() === String(c.equals).toLowerCase()
    }
    return value === condition
  })
}

function defined(data: Row): Row {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
}

let seq = 0
function table(rows: Row[], prefix: string) {
  return {
    rows,
    findFirst: jest.fn(({ where }: { where?: Where }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)))),
    findUnique: jest.fn(({ where }: { where: Where }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    count: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)).length)),
    create: jest.fn(({ data }: { data: Row }) => {
      const row = { id: `${prefix}-${++seq}`, active: true, ...defined(data) }
      rows.push(row)
      return Promise.resolve(row)
    }),
    update: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const row = rows.find((item) => matches(item, where))
      if (!row) return Promise.reject(new Error('not found'))
      Object.assign(row, defined(data))
      return Promise.resolve(row)
    }),
    updateMany: jest.fn(({ where, data }: { where: Where; data: Row }) => {
      const found = rows.filter((row) => matches(row, where))
      found.forEach((row) => Object.assign(row, defined(data)))
      return Promise.resolve({ count: found.length })
    }),
    delete: jest.fn(({ where }: { where: Where }) => {
      const index = rows.findIndex((row) => matches(row, where))
      if (index >= 0) rows.splice(index, 1)
      return Promise.resolve({})
    }),
  }
}

interface Seed {
  users?: Row[]
  teams?: Row[]
  leads?: Row[]
  tasks?: Row[]
  properties?: Row[]
  goals?: Row[]
  sales?: Row[]
  seats?: number
}

function fakeDb(seed: Seed) {
  const tables = {
    user: table(seed.users ?? [], 'u'),
    team: table(seed.teams ?? [], 't'),
    lead: table(seed.leads ?? [], 'l'),
    task: table(seed.tasks ?? [], 'k'),
    property: table(seed.properties ?? [], 'p'),
    goal: table(seed.goals ?? [], 'g'),
    sale: table(seed.sales ?? [], 's'),
    interaction: table([], 'i'),
    propertyShare: table([], 'h'),
    dailyActivity: table([], 'd'),
    goalDailyEntry: table([], 'e'),
    billingEvent: table([], 'b'),
    organization: { findUnique: jest.fn(() => Promise.resolve({ seats: seed.seats ?? 50, plan: 'equipe' })) },
  }
  return { ...tables, $transaction: (fn: (tx: typeof tables) => Promise<unknown>) => fn(tables) }
}

const person = (id: string, role: Role, extra: Row = {}): Row => ({
  id, name: `Pessoa ${id}`, email: `${id}@x.com`, role, teamId: null, organizationId: ORG, active: true, ...extra,
})
const actorOf = (role: Role, teamId: string | null = null, id = `ator-${role}`): Actor => ({
  id, role, teamId, organizationId: ORG, email: `${id}@x.com`,
})

function setup(seed: Seed = {}) {
  const db = fakeDb(seed)
  const auth = { hashPassword: jest.fn((password: string) => Promise.resolve(`hash:${password}`)) }
  const service = new UsersService(db as unknown as PrismaService, auth as unknown as AuthService)
  return { db, service }
}

const statusOf = (error: unknown) => (error instanceof HttpException ? error.getStatus() : undefined)

// ---------------------------------------------------------------- canManageUser no editar e no desativar

describe('canManageUser no editar e no desativar', () => {
  const cases = ROLES.flatMap((actorRole) => ROLES.map((targetRole) => [actorRole, targetRole] as const))

  it.each(cases)('%s edita %s', async (actorRole, targetRole) => {
    const team = actorRole === 'coordenador' ? 't1' : null
    const { service } = setup({
      users: [person('alvo', targetRole, { teamId: team }), person('outro-diretor', 'diretor')],
      teams: [{ id: 't1', organizationId: ORG, active: true, coordinatorId: null }],
    })
    const result = service.update(actorOf(actorRole, team), 'alvo', { name: 'Novo nome' })
    if (canManageUser(actorRole, targetRole)) await expect(result).resolves.toMatchObject({ name: 'Novo nome' })
    else await expect(result).rejects.toBeInstanceOf(ForbiddenException)
  })

  it.each(cases)('%s desativa %s', async (actorRole, targetRole) => {
    const team = actorRole === 'coordenador' ? 't1' : null
    const { service } = setup({
      users: [person('alvo', targetRole, { teamId: team }), person('outro-diretor', 'diretor')],
      teams: [{ id: 't1', organizationId: ORG, active: true, coordinatorId: null }],
    })
    const result = service.deactivate(actorOf(actorRole, team), 'alvo', {})
    if (canManageUser(actorRole, targetRole)) await expect(result).resolves.toHaveProperty('summary')
    else await expect(result).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('mudar o cargo exige poder gerir o cargo novo também', async () => {
    const { service } = setup({ users: [person('alvo', 'corretor')] })
    await expect(service.update(actorOf('gerente'), 'alvo', { role: 'diretor' })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.update(actorOf('gerente'), 'alvo', { role: 'coordenador' })).resolves.toMatchObject({ role: 'coordenador' })
  })

  it('coordenador não desativa quem é de outra equipe', async () => {
    const { service } = setup({ users: [person('alvo', 'corretor', { teamId: 't2' })] })
    await expect(service.deactivate(actorOf('coordenador', 't1'), 'alvo', {})).rejects.toBeInstanceOf(ForbiddenException)
  })
})

// ---------------------------------------------------------------- travas de auto-ação

describe('auto-ação', () => {
  it('ninguém altera o próprio cargo', async () => {
    const { service } = setup({ users: [person('ator-gerente', 'gerente')] })
    const error = await service.update(actorOf('gerente'), 'ator-gerente', { role: 'diretor' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ForbiddenException)
    expect((error as ForbiddenException).message).toBe('Você não pode alterar o próprio cargo')
  })

  it('mandar o mesmo cargo de volta não é alteração', async () => {
    const { service } = setup({ users: [person('ator-gerente', 'gerente')] })
    await expect(service.update(actorOf('gerente'), 'ator-gerente', { role: 'gerente', name: 'Eu' })).resolves.toMatchObject({ name: 'Eu' })
  })

  it('ninguém se desativa', async () => {
    const { service } = setup({ users: [person('ator-diretor', 'diretor'), person('d2', 'diretor')] })
    const error = await service.deactivate(actorOf('diretor'), 'ator-diretor', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ForbiddenException)
    expect((error as ForbiddenException).message).toBe('Você não pode desativar a si mesmo')
  })

  it('ninguém se exclui', async () => {
    const { service } = setup({ users: [person('ator-diretor', 'diretor'), person('d2', 'diretor')] })
    await expect(service.remove(actorOf('diretor'), 'ator-diretor')).rejects.toBeInstanceOf(ForbiddenException)
  })
})

// ---------------------------------------------------------------- e-mail

describe('e-mail', () => {
  it('coordenador não altera e-mail; gerente altera', async () => {
    const users = () => [person('alvo', 'corretor', { teamId: 't1' })]
    const coordinator = setup({ users: users() })
    await expect(
      coordinator.service.update(actorOf('coordenador', 't1'), 'alvo', { email: 'novo@x.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    const manager = setup({ users: users() })
    await expect(manager.service.update(actorOf('gerente'), 'alvo', { email: 'NOVO@x.com ' })).resolves.toMatchObject({ email: 'novo@x.com' })
  })

  it('e-mail de outra pessoa dá 409; o próprio e-mail não conflita', async () => {
    const { service } = setup({ users: [person('alvo', 'corretor'), person('outro', 'corretor')] })
    await expect(service.update(actorOf('gerente'), 'alvo', { email: 'outro@x.com' })).rejects.toBeInstanceOf(ConflictException)
    await expect(service.update(actorOf('gerente'), 'alvo', { email: 'alvo@x.com', name: 'Mesmo' })).resolves.toMatchObject({ name: 'Mesmo' })
  })
})

// ---------------------------------------------------------------- desativar

describe('desativar', () => {
  it('último diretor ativo é protegido; com outro diretor ativo, passa', async () => {
    const alone = setup({ users: [person('d1', 'diretor'), person('d2', 'diretor', { active: false })] })
    await expect(alone.service.deactivate(actorOf('diretor'), 'd1', {})).rejects.toBeInstanceOf(ConflictException)

    const pair = setup({ users: [person('d1', 'diretor'), person('d2', 'diretor')] })
    await expect(pair.service.deactivate(actorOf('diretor'), 'd1', {})).resolves.toHaveProperty('user')
  })

  it('coordenador de equipe é bloqueado até trocar o coordenador', async () => {
    const { service } = setup({
      users: [person('coord', 'coordenador', { teamId: 't1' })],
      teams: [{ id: 't1', name: 'Alfa', organizationId: ORG, active: true, coordinatorId: 'coord' }],
    })
    const error = await service.deactivate(actorOf('gerente'), 'coord', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toContain('Alfa')
  })

  it('grava motivo, data e quem desativou, e devolve o resumo da carteira sem mexer nela', async () => {
    const { service, db } = setup({
      users: [person('c1', 'corretor')],
      leads: [
        { id: 'l1', organizationId: ORG, ownerId: 'c1', active: true, status: 'novo' },
        { id: 'l2', organizationId: ORG, ownerId: 'c1', active: true, status: 'ganho' },
      ],
      tasks: [
        { id: 'k1', organizationId: ORG, assignedTo: 'c1', status: 'pendente' },
        { id: 'k2', organizationId: ORG, assignedTo: 'c1', status: 'concluida' },
      ],
      properties: [{ id: 'p1', organizationId: ORG, ownerId: 'c1', active: true }],
      goals: [{ id: 'g1', organizationId: ORG, userId: 'c1', active: true }],
    })
    const result = await service.deactivate(actorOf('gerente'), 'c1', { reason: '  Saiu da empresa ' })
    expect(result.summary).toEqual({ leadsAtivos: 1, tarefasPendentes: 1, imoveis: 1, metasAtivas: 1 })
    expect(db.user.rows[0]).toMatchObject({
      active: false, deactivatedBy: 'ator-gerente', deactivationReason: 'Saiu da empresa',
    })
    expect(db.user.rows[0].deactivatedAt).toBeInstanceOf(Date)
    // Nada saiu do nome dela
    expect(db.lead.rows.every((lead) => lead.ownerId === 'c1')).toBe(true)
    expect(db.task.rows.every((task) => task.assignedTo === 'c1')).toBe(true)
    expect(db.billingEvent.rows[0]).toMatchObject({ kind: 'usuario_desativado', createdBy: 'ator-gerente@x.com' })
  })

  it('libera o assento: com o plano cheio, desativar abre vaga para criar outro usuário', async () => {
    const { service } = setup({ seats: 2, users: [person('d1', 'diretor'), person('c1', 'corretor')] })
    const novo = { name: 'Nova', email: 'nova@x.com', role: 'corretor' }
    const full = await service.create(actorOf('diretor'), novo).catch((e: unknown) => e)
    expect(statusOf(full)).toBe(402)

    await service.deactivate(actorOf('diretor'), 'c1', {})
    await expect(service.create(actorOf('diretor'), novo)).resolves.toHaveProperty('id')
  })

  it('derruba a sessão: o JwtStrategy recusa quem foi desativado, mesmo com token válido', async () => {
    const { service, db } = setup({ users: [person('c1', 'corretor', { updatedAt: new Date(1000) })] })
    const strategy = new JwtStrategy(
      { getOrThrow: () => 'segredo' } as unknown as ConfigService,
      db as unknown as PrismaService,
    )
    const payload = { sub: 'c1', email: 'c1@x.com', role: 'corretor', organizationId: ORG, teamId: null, pwd: 1000 }
    await expect(strategy.validate(payload)).resolves.toMatchObject({ id: 'c1' })

    await service.deactivate(actorOf('gerente'), 'c1', {})
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})

// ---------------------------------------------------------------- reativar

describe('reativar', () => {
  it('respeita o limite do plano e limpa os campos de desativação', async () => {
    const inactive = person('c2', 'corretor', {
      active: false, deactivatedAt: new Date(), deactivatedBy: 'x', deactivationReason: 'motivo',
    })
    const full = setup({ seats: 1, users: [person('d1', 'diretor'), inactive] })
    const error = await full.service.activate(actorOf('diretor'), 'c2').catch((e: unknown) => e)
    expect(statusOf(error)).toBe(402)
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'SEAT_LIMIT' })

    const free = setup({ seats: 2, users: [person('d1', 'diretor'), { ...inactive }] })
    await free.service.activate(actorOf('diretor'), 'c2')
    expect(free.db.user.rows[1]).toMatchObject({
      active: true, deactivatedAt: null, deactivatedBy: null, deactivationReason: null,
    })
  })
})

// ---------------------------------------------------------------- transferir carteira

describe('transferir carteira', () => {
  const seed = (): Seed => ({
    users: [person('de', 'corretor', { teamId: 't1' }), person('para', 'corretor', { teamId: 't2' })],
    leads: [
      { id: 'l1', organizationId: ORG, ownerId: 'de', active: true, status: 'novo', teamId: 't1' },
      { id: 'l2', organizationId: ORG, ownerId: 'de', active: true, status: 'perdido', teamId: 't1' },
    ],
    tasks: [
      { id: 'k1', organizationId: ORG, assignedTo: 'de', status: 'pendente' },
      { id: 'k2', organizationId: ORG, assignedTo: 'de', status: 'concluida' },
    ],
    properties: [{ id: 'p1', organizationId: ORG, ownerId: 'de', active: true }],
    goals: [{ id: 'g1', organizationId: ORG, userId: 'de', active: true }],
    sales: [{ id: 's1', organizationId: ORG, brokerId: 'de' }],
  })

  it('move leads ativos, tarefas pendentes e imóveis; não move metas nem vendas', async () => {
    const { service, db } = setup(seed())
    const moved = await service.transfer(actorOf('gerente'), 'de', { toUserId: 'para', what: ['leads', 'tasks', 'properties'] })
    expect(moved).toEqual({ leads: 1, tasks: 1, properties: 1 })
    expect(db.lead.rows.map((row) => row.ownerId)).toEqual(['para', 'de'])
    expect(db.lead.rows[0].teamId).toBe('t2')
    expect(db.task.rows.map((row) => row.assignedTo)).toEqual(['para', 'de'])
    expect(db.property.rows[0].ownerId).toBe('para')
    expect(db.goal.rows[0].userId).toBe('de')
    expect(db.sale.rows[0].brokerId).toBe('de')
    expect(db.billingEvent.rows[0]).toMatchObject({ kind: 'carteira_transferida' })
  })

  it('só move o que foi escolhido', async () => {
    const { service, db } = setup(seed())
    const moved = await service.transfer(actorOf('gerente'), 'de', { toUserId: 'para', what: ['tasks'] })
    expect(moved).toEqual({ leads: 0, tasks: 1, properties: 0 })
    expect(db.lead.rows.every((row) => row.ownerId === 'de')).toBe(true)
  })

  it('recusa quem recebe inativo, o mesmo usuário e cargo que o ator não gere', async () => {
    const inactive = setup({ users: [person('de', 'corretor'), person('para', 'corretor', { active: false })] })
    await expect(
      inactive.service.transfer(actorOf('gerente'), 'de', { toUserId: 'para', what: ['leads'] }),
    ).rejects.toBeInstanceOf(Error)

    const same = setup({ users: [person('de', 'corretor')] })
    await expect(same.service.transfer(actorOf('gerente'), 'de', { toUserId: 'de', what: ['leads'] })).rejects.toBeInstanceOf(Error)

    const director = setup({ users: [person('de', 'corretor'), person('chefe', 'diretor')] })
    await expect(
      director.service.transfer(actorOf('gerente'), 'de', { toUserId: 'chefe', what: ['leads'] }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

// ---------------------------------------------------------------- excluir

describe('excluir', () => {
  it('com vínculos: 409 com a lista do que impede, e nada é apagado', async () => {
    const { service, db } = setup({
      users: [person('c1', 'corretor'), person('d1', 'diretor')],
      leads: [{ id: 'l1', organizationId: ORG, ownerId: 'c1' }],
      tasks: [{ id: 'k1', organizationId: ORG, createdBy: 'c1', assignedTo: 'outro' }],
    })
    const error = await service.remove(actorOf('diretor'), 'c1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    const body = (error as ConflictException).getResponse() as { message: string; blockers: { kind: string; count: number }[] }
    expect(body.blockers.map((blocker) => blocker.kind)).toEqual(['leads', 'tasks'])
    expect(body.message).toContain('1 leads, 1 tarefas')
    expect(db.user.rows.some((row) => row.id === 'c1')).toBe(true)
    expect(db.billingEvent.rows).toHaveLength(0)
  })

  it.each([
    ['meta', { goals: [{ id: 'g', organizationId: ORG, userId: 'c1' }] }],
    ['venda', { sales: [{ id: 's', organizationId: ORG, brokerId: 'c1' }] }],
    ['imóvel', { properties: [{ id: 'p', organizationId: ORG, ownerId: 'c1' }] }],
  ])('%s vinculado também impede', async (_name, extra) => {
    const { service } = setup({ users: [person('c1', 'corretor')], ...extra })
    await expect(service.remove(actorOf('diretor'), 'c1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('sem vínculos: apaga e deixa o registro na organização', async () => {
    const { service, db } = setup({ users: [person('c1', 'corretor'), person('d1', 'diretor')] })
    await expect(service.remove(actorOf('diretor'), 'c1')).resolves.toEqual({ ok: true })
    expect(db.user.rows.some((row) => row.id === 'c1')).toBe(false)
    expect(db.billingEvent.rows[0]).toMatchObject({ kind: 'usuario_excluido', createdBy: 'ator-diretor@x.com' })
  })

  it('o último diretor não pode ser excluído', async () => {
    const { service } = setup({ users: [person('d1', 'diretor')] })
    const error = await service.remove(actorOf('diretor', null, 'outro-ator'), 'd1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).message).toBe('A imobiliária precisa de ao menos um diretor ativo')
  })
})

// ---------------------------------------------------------------- listagem

describe('listagem de inativos', () => {
  it('padrão só ativos; inativos trazem quem desativou; corretor não vê inativos', async () => {
    const { service } = setup({
      users: [
        person('d1', 'diretor', { name: 'Diana' }),
        person('c1', 'corretor', { active: false, deactivatedBy: 'd1', deactivatedAt: new Date() }),
      ],
    })
    expect((await service.findAll(actorOf('diretor'))).map((user) => user.id)).toEqual(['d1'])
    const inactive = await service.findAll(actorOf('diretor'), { active: 'false' })
    expect(inactive).toMatchObject([{ id: 'c1', deactivatedByName: 'Diana' }])
    expect(await service.findAll(actorOf('diretor'), { active: 'all' })).toHaveLength(2)
    await expect(service.findAll(actorOf('corretor'), { active: 'all' })).rejects.toBeInstanceOf(ForbiddenException)
  })
})
