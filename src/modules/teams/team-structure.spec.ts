import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import type { AuthService } from '../auth/auth.service'
import { canManageUser, ROLES, type Actor, type Role } from '../users/user-permissions'
import { UsersService } from '../users/users.service'
import { TeamsService } from './teams.service'

// Montar a estrutura numa base vazia: equipe e coordenador opcionais, regra de quem gere quem, membros

const ORG = 'org-1'

// ---------------------------------------------------------------- banco em memória

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key] ?? null
    if (condition !== null && typeof condition === 'object') {
      const c = condition as { in?: unknown[]; not?: unknown }
      if (c.in) return c.in.includes(value)
      if ('not' in c) return value !== c.not
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
    findUnique: jest.fn(({ where }: { where: Where }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findUniqueOrThrow: jest.fn(({ where }: { where: Where }) => Promise.resolve(rows.find((row) => matches(row, where)))),
    findFirst: jest.fn(({ where }: { where?: Where }) => Promise.resolve(rows.find((row) => matches(row, where)) ?? null)),
    findMany: jest.fn(({ where }: { where?: Where } = {}) => Promise.resolve(rows.filter((row) => matches(row, where)))),
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
  }
}

function fakeDb(users: Row[], teams: Row[]) {
  // Sem organização: o limite de assentos não se aplica (testado em billing.spec.ts)
  const tables = { user: table(users, 'u'), team: table(teams, 't'), organization: { findUnique: jest.fn(() => Promise.resolve(null)) } }
  return { ...tables, $transaction: (fn: (tx: typeof tables) => Promise<unknown>) => fn(tables) }
}

const user = (id: string, role: Role, teamId: string | null = null): Row => ({
  id, name: id, email: `${id}@x.com`, role, teamId, organizationId: ORG, active: true,
})
const team = (id: string, coordinatorId: string | null = null): Row => ({
  id, name: `Equipe ${id}`, coordinatorId, organizationId: ORG, active: true,
})
const actor = (role: Role, teamId: string | null = null, id = `ator-${role}`): Actor => ({
  id, role, teamId, organizationId: ORG,
})

function setup(users: Row[] = [], teams: Row[] = []) {
  const db = fakeDb(users, teams)
  const auth = { hashPassword: jest.fn((password: string) => Promise.resolve(`hash:${password}`)) }
  const prisma = db as unknown as PrismaService
  return {
    db,
    auth,
    users: new UsersService(prisma, auth as unknown as AuthService),
    teams: new TeamsService(prisma),
  }
}

// ---------------------------------------------------------------- canManageUser

describe('canManageUser', () => {
  const expected: Record<Role, Role[]> = {
    diretor: ['diretor', 'gerente', 'coordenador', 'corretor', 'administrativo'],
    gerente: ['gerente', 'coordenador', 'corretor', 'administrativo'],
    coordenador: ['corretor', 'administrativo'],
    corretor: [],
    administrativo: [],
  }
  for (const actorRole of ROLES) {
    for (const targetRole of ROLES) {
      const allowed = expected[actorRole].includes(targetRole)
      it(`${actorRole} ${allowed ? 'pode' : 'não pode'} gerir ${targetRole}`, () => {
        expect(canManageUser(actorRole, targetRole)).toBe(allowed)
      })
    }
  }
  it('cargo desconhecido nunca pode', () => {
    expect(canManageUser('dono', 'corretor')).toBe(false)
    expect(canManageUser('diretor', 'dono')).toBe(false)
  })
})

// ---------------------------------------------------------------- usuários

describe('UsersService: criar e editar', () => {
  const base = { name: 'Fulano', email: 'f@x.com' }

  it('cria sem equipe e sem senha, devolvendo temporaryPassword uma vez', async () => {
    const { users, auth, db } = setup()
    const created = await users.create(actor('diretor'), { ...base, role: 'coordenador' })
    expect(created).toMatchObject({ role: 'coordenador', teamId: null })
    expect('temporaryPassword' in created && created.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/)
    const password = 'temporaryPassword' in created ? created.temporaryPassword : ''
    expect(auth.hashPassword).toHaveBeenCalledWith(password)
    expect(db.user.rows[0].passwordHash).toBe(`hash:${password}`)
  })

  it('com senha informada não devolve temporaryPassword', async () => {
    const { users } = setup()
    const created = await users.create(actor('diretor'), { ...base, role: 'corretor', password: 'segredo1' })
    expect(created).not.toHaveProperty('temporaryPassword')
  })

  it('coordenador cria corretor, mas não coordenador (403)', async () => {
    const { users } = setup([], [team('t1')])
    await expect(users.create(actor('coordenador', 't1'), { ...base, role: 'corretor' })).resolves.toMatchObject({ role: 'corretor' })
    await expect(users.create(actor('coordenador', 't1'), { ...base, email: 'g@x.com', role: 'coordenador' })).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('gerente cria gerente, mas não diretor (403)', async () => {
    const { users } = setup()
    await expect(users.create(actor('gerente'), { ...base, role: 'gerente' })).resolves.toMatchObject({ role: 'gerente' })
    await expect(users.create(actor('gerente'), { ...base, email: 'd@x.com', role: 'diretor' })).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('diretor cria outro diretor', async () => {
    const { users } = setup()
    await expect(users.create(actor('diretor'), { ...base, role: 'diretor' })).resolves.toMatchObject({ role: 'diretor' })
  })

  it('teamId de outra organização dá 400', async () => {
    const { users } = setup([], [{ ...team('t9'), organizationId: 'outra' }])
    await expect(users.create(actor('diretor'), { ...base, role: 'corretor', teamId: 't9' })).rejects.toThrow(BadRequestException)
  })

  it('update: mudar o cargo exige poder gerir o atual e o novo', async () => {
    const { users } = setup([user('c1', 'corretor'), user('g1', 'gerente')])
    await expect(users.update(actor('coordenador'), 'c1', { role: 'coordenador' })).rejects.toThrow(ForbiddenException)
    await expect(users.update(actor('coordenador'), 'g1', { name: 'x' })).rejects.toThrow(ForbiddenException)
    await expect(users.update(actor('gerente'), 'c1', { role: 'coordenador' })).resolves.toMatchObject({ role: 'coordenador' })
  })

  it('update: teamId null tira da equipe', async () => {
    const { users } = setup([user('c1', 'corretor', 't1')], [team('t1')])
    await expect(users.update(actor('gerente'), 'c1', { teamId: null })).resolves.toMatchObject({ teamId: null })
  })

  it('update: editar o próprio nome não depende de cargo', async () => {
    const { users } = setup([user('ator-coordenador', 'coordenador', 't1')], [team('t1')])
    await expect(users.update(actor('coordenador', 't1'), 'ator-coordenador', { name: 'Novo' })).resolves.toMatchObject({
      name: 'Novo',
    })
  })
})

describe('UsersService: listagem', () => {
  const rows = () => [
    user('d1', 'diretor'),
    user('k1', 'coordenador', 't1'),
    user('c1', 'corretor', 't1'),
    user('c2', 'corretor'),
    user('a1', 'administrativo'),
    user('c3', 'corretor', 't2'),
  ]

  it('teamId=none com gerente lista quem está sem equipe, filtrando por cargo', async () => {
    const { users } = setup(rows())
    const semEquipe = await users.findAll(actor('gerente'), { teamId: 'none' })
    expect(semEquipe.map((row) => row.id).sort()).toEqual(['a1', 'c2', 'd1'])
    const corretores = await users.findAll(actor('gerente'), { teamId: 'none', role: 'corretor' })
    expect(corretores.map((row) => row.id)).toEqual(['c2'])
  })

  it('coordenador vê só a própria equipe e nada com teamId=none', async () => {
    const { users } = setup(rows())
    const visible = await users.findAll(actor('coordenador', 't1', 'k1'))
    expect(visible.map((row) => row.id).sort()).toEqual(['c1', 'k1'])
    expect(await users.findAll(actor('coordenador', 't1', 'k1'), { teamId: 'none' })).toEqual([])
    expect(await users.findAll(actor('coordenador', 't1', 'k1'), { teamId: 't2' })).toEqual([])
  })

  it('coordenador sem equipe vê só a si mesmo', async () => {
    const { users } = setup([...rows(), user('k2', 'coordenador')])
    const visible = await users.findAll(actor('coordenador', null, 'k2'))
    expect(visible.map((row) => row.id)).toEqual(['k2'])
  })
})

// ---------------------------------------------------------------- equipes

describe('TeamsService: coordenador', () => {
  it('cria equipe sem coordenador', async () => {
    const { teams } = setup()
    const created = await teams.create(actor('diretor'), { name: 'Alfa' })
    expect(created).toMatchObject({ name: 'Alfa', coordinatorId: null })
  })

  it('definir o coordenador na criação coloca ele na equipe', async () => {
    const { teams, db } = setup([user('k1', 'coordenador')])
    const created = await teams.create(actor('diretor'), { name: 'Alfa', coordinatorId: 'k1' })
    expect(created?.coordinatorId).toBe('k1')
    expect(db.user.rows[0].teamId).toBe(created?.id)
  })

  it('definir o coordenador depois (update) atualiza o teamId dele', async () => {
    const { teams, db } = setup([user('k1', 'coordenador')], [team('t1')])
    await teams.update(actor('gerente'), 't1', { coordinatorId: 'k1' })
    expect(db.team.rows[0].coordinatorId).toBe('k1')
    expect(db.user.rows[0].teamId).toBe('t1')
  })

  it('remover o coordenador (null) não mexe no teamId dele', async () => {
    const { teams, db } = setup([user('k1', 'coordenador', 't1')], [team('t1', 'k1')])
    await teams.update(actor('gerente'), 't1', { coordinatorId: null })
    expect(db.team.rows[0].coordinatorId).toBeNull()
    expect(db.user.rows[0].teamId).toBe('t1')
  })

  it('coordenador que já coordena outra equipe dá 409 com o nome dela', async () => {
    const { teams } = setup([user('k1', 'coordenador', 't1')], [team('t1', 'k1'), team('t2')])
    const attempt = teams.update(actor('gerente'), 't2', { coordinatorId: 'k1' })
    await expect(attempt).rejects.toThrow(ConflictException)
    await expect(teams.update(actor('gerente'), 't2', { coordinatorId: 'k1' })).rejects.toThrow('Equipe t1')
  })

  it('redefinir o mesmo coordenador na própria equipe não conflita', async () => {
    const { teams } = setup([user('k1', 'coordenador', 't1')], [team('t1', 'k1')])
    await expect(teams.update(actor('gerente'), 't1', { coordinatorId: 'k1' })).resolves.toBeDefined()
  })

  it('coordenador com cargo corretor dá 400', async () => {
    const { teams } = setup([user('c1', 'corretor')])
    await expect(teams.create(actor('diretor'), { name: 'Alfa', coordinatorId: 'c1' })).rejects.toThrow(
      'Só coordenador ou superior pode coordenar uma equipe',
    )
  })

  it('PATCH sem nada dá 400', async () => {
    const { teams } = setup([], [team('t1')])
    await expect(teams.update(actor('gerente'), 't1', {})).rejects.toThrow(BadRequestException)
  })
})

describe('TeamsService: membros', () => {
  it('move membros entre equipes numa chamada', async () => {
    const { teams, db } = setup(
      [user('c1', 'corretor'), user('c2', 'corretor', 't2'), user('c3', 'corretor', 't1')],
      [team('t1'), team('t2')],
    )
    await teams.updateMembers(actor('gerente'), 't1', { addUserIds: ['c1', 'c2'], removeUserIds: ['c3'] })
    const teamOf = (id: string) => db.user.rows.find((row) => row.id === id)?.teamId
    expect(teamOf('c1')).toBe('t1')
    expect(teamOf('c2')).toBe('t1')
    expect(teamOf('c3')).toBeNull()
  })

  it('remover o coordenador da própria equipe dá 409', async () => {
    const { teams } = setup([user('k1', 'coordenador', 't1')], [team('t1', 'k1')])
    await expect(teams.updateMembers(actor('gerente'), 't1', { removeUserIds: ['k1'] })).rejects.toThrow(ConflictException)
  })

  it('adicionar quem coordena outra equipe dá 409', async () => {
    const { teams } = setup([user('k1', 'coordenador', 't2')], [team('t1'), team('t2', 'k1')])
    await expect(teams.updateMembers(actor('gerente'), 't1', { addUserIds: ['k1'] })).rejects.toThrow(ConflictException)
  })

  it('coordenador só mexe na própria equipe e só em quem pode gerir', async () => {
    const { teams } = setup(
      [user('c1', 'corretor'), user('k2', 'coordenador'), user('c9', 'corretor', 't2')],
      [team('t1', 'k1'), team('t2')],
    )
    const coord = actor('coordenador', 't1', 'k1')
    await expect(teams.updateMembers(coord, 't2', { addUserIds: ['c1'] })).rejects.toThrow(ForbiddenException)
    await expect(teams.updateMembers(coord, 't1', { addUserIds: ['k2'] })).rejects.toThrow(ForbiddenException)
    await expect(teams.updateMembers(coord, 't1', { addUserIds: ['c9'] })).rejects.toThrow(ForbiddenException)
    await expect(teams.updateMembers(coord, 't1', { addUserIds: ['c1'] })).resolves.toBeDefined()
  })

  it('usuário de outra organização dá 400', async () => {
    const { teams } = setup([{ ...user('x1', 'corretor'), organizationId: 'outra' }], [team('t1')])
    await expect(teams.updateMembers(actor('gerente'), 't1', { addUserIds: ['x1'] })).rejects.toThrow(BadRequestException)
  })

  it('lista vazia dá 400', async () => {
    const { teams } = setup([], [team('t1')])
    await expect(teams.updateMembers(actor('gerente'), 't1', {})).rejects.toThrow('Nada para atualizar')
  })
})

describe('mudar de equipe não encerra sessões', () => {
  it('definir coordenador e mover membros mantêm o updatedAt de cada pessoa', async () => {
    const stamp = new Date('2026-11-01T12:00:00.000Z')
    const users: Row[] = [
      { ...user('coord', 'coordenador'), updatedAt: stamp },
      { ...user('c1', 'corretor'), updatedAt: stamp },
    ]
    const { db, teams } = setup(users, [team('t1')])
    await teams.update(actor('diretor'), 't1', { coordinatorId: 'coord' })
    await teams.updateMembers(actor('diretor'), 't1', { addUserIds: ['c1'] })
    await teams.updateMembers(actor('diretor'), 't1', { removeUserIds: ['c1'] })
    expect(users.map((row) => row.updatedAt)).toEqual([stamp, stamp])
    expect(users[0].teamId).toBe('t1')
    expect(users[1].teamId).toBeNull()
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })
})
