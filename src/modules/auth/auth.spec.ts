import { BadRequestException, HttpException, Logger, UnauthorizedException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import type { PrismaService } from '../../prisma/prisma.service'
import { UsersService } from '../users/users.service'
import { AuthService } from './auth.service'
import type { JwtPayload } from './interfaces/jwt-payload.interface'
import { PasswordAttempts } from './password-attempts'
import { JwtStrategy } from './strategies/jwt.strategy'

// Perfil, troca de senha, carimbo "pwd" no token e e-mail normalizado

const ORG = 'org-1'
const SECRET = 'segredo-de-teste'

type UserRow = {
  id: string
  name: string
  email: string
  passwordHash: string
  role: string
  organizationId: string
  teamId: string | null
  phone: string | null
  creci: string | null
  avatarUrl: string | null
  active: boolean
  createdAt: Date
  updatedAt: Date
  lastLogin?: Date
}

type EmailFilter = string | { equals: string; mode?: 'insensitive' }

function emailMatches(email: string, filter: EmailFilter) {
  if (typeof filter === 'string') return email === filter
  return filter.mode === 'insensitive' ? email.toLowerCase() === filter.equals.toLowerCase() : email === filter.equals
}

/** Banco em memória com o comportamento do @updatedAt do Prisma: muda em todo update, salvo se vier explícito */
function fakeDb(rows: UserRow[]) {
  let clock = Date.parse('2026-11-01T12:00:00.000Z')
  const tick = () => new Date((clock += 1000))
  const withRelations = (row: UserRow) => ({ ...row, team: null, organization: { id: ORG, name: 'Imob Teste', slug: 'imob', plan: 'free' } })
  const user = {
    findFirst: jest.fn(({ where }: { where: { email?: EmailFilter; id?: string } }) =>
      Promise.resolve(
        rows.find((row) => (where.email !== undefined ? emailMatches(row.email, where.email) : row.id === where.id)) ?? null,
      ).then((row) => row && withRelations(row)),
    ),
    findUnique: jest.fn(({ where }: { where: { id?: string; email?: string } }) =>
      Promise.resolve(rows.find((row) => (where.id ? row.id === where.id : row.email === where.email)) ?? null).then(
        (row) => row && withRelations(row),
      ),
    ),
    create: jest.fn(({ data }: { data: Partial<UserRow> }) => {
      const row: UserRow = {
        id: `u-${rows.length + 1}`, name: '', email: '', passwordHash: '', role: 'corretor', organizationId: ORG,
        teamId: null, phone: null, creci: null, avatarUrl: null, active: true, createdAt: new Date(), updatedAt: tick(),
        ...data,
      }
      rows.push(row)
      return Promise.resolve(withRelations(row))
    }),
    update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
      const row = rows.find((item) => item.id === where.id)
      if (!row) return Promise.reject(new Error('not found'))
      Object.assign(row, data, { updatedAt: data.updatedAt ?? tick() })
      return Promise.resolve(withRelations(row))
    }),
  }
  return { user, team: { findFirst: jest.fn(() => Promise.resolve(null)) } }
}

async function setup() {
  const rows: UserRow[] = []
  const db = fakeDb(rows)
  const prisma = db as unknown as PrismaService
  const config = { get: () => '7d', getOrThrow: () => SECRET } as unknown as ConfigService
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } })
  const auth = new AuthService(prisma, jwt, config, new PasswordAttempts())
  const strategy = new JwtStrategy(config, prisma)
  const users = new UsersService(prisma, auth)
  const passwordHash = await auth.hashPassword('senha-antiga')
  rows.push({
    id: 'u-1', name: 'Carla', email: 'carla@x.com', passwordHash, role: 'corretor', organizationId: ORG, teamId: null,
    phone: null, creci: null, avatarUrl: null, active: true, createdAt: new Date(), updatedAt: new Date('2026-11-01T12:00:00.000Z'),
  })
  const decode = (token: string) => jwt.verify<JwtPayload>(token)
  return { rows, db, auth, strategy, users, decode }
}

describe('token com carimbo da sessão (pwd)', () => {
  it('login grava pwd = updatedAt e não muda o updatedAt (não derruba outros aparelhos)', async () => {
    const { auth, rows, decode } = await setup()
    const before = rows[0].updatedAt.getTime()
    const first = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    const second = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    expect(rows[0].updatedAt.getTime()).toBe(before)
    expect(decode(first.accessToken).pwd).toBe(before)
    expect(decode(second.accessToken).pwd).toBe(before)
  })

  it('token emitido antes da troca de senha deixa de valer; os novos continuam valendo', async () => {
    const { auth, strategy, decode } = await setup()
    const old = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    await expect(strategy.validate(decode(old.accessToken))).resolves.toMatchObject({ id: 'u-1' })

    const fresh = await auth.changePassword('u-1', { currentPassword: 'senha-antiga', newPassword: 'senha-nova-123' })

    await expect(strategy.validate(decode(old.accessToken))).rejects.toThrow(UnauthorizedException)
    await expect(auth.refresh(old.refreshToken)).rejects.toThrow(UnauthorizedException)
    await expect(strategy.validate(decode(fresh.accessToken))).resolves.toMatchObject({ id: 'u-1' })
    await expect(auth.refresh(fresh.refreshToken)).resolves.toHaveProperty('accessToken')
  })

  it('o usuário validado não expõe o updatedAt', async () => {
    const { auth, strategy, decode } = await setup()
    const { accessToken } = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    const user = await strategy.validate(decode(accessToken))
    expect(user).not.toHaveProperty('updatedAt')
  })

  it('token sem pwd (emitido antes desta regra) não vale', async () => {
    const { strategy } = await setup()
    const legacy: JwtPayload = { sub: 'u-1', email: 'carla@x.com', role: 'corretor', organizationId: ORG, teamId: null }
    await expect(strategy.validate(legacy)).rejects.toThrow(UnauthorizedException)
  })

  it('editar o perfil derruba as outras sessões e devolve tokens novos', async () => {
    const { auth, strategy, decode } = await setup()
    const old = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    const result = await auth.updateProfile('u-1', { phone: '11987654321' })
    await expect(strategy.validate(decode(old.accessToken))).rejects.toThrow(UnauthorizedException)
    await expect(strategy.validate(decode(result.accessToken))).resolves.toMatchObject({ id: 'u-1' })
  })

  it('redefinir a senha pelo gestor derruba as sessões da pessoa', async () => {
    const { auth, strategy, users, decode } = await setup()
    const old = await auth.login({ email: 'carla@x.com', password: 'senha-antiga' })
    const gerente = { id: 'g-1', role: 'gerente', organizationId: ORG, teamId: null }
    await users.resetPassword(gerente, 'u-1', { password: 'definida-pelo-gestor' })
    await expect(strategy.validate(decode(old.accessToken))).rejects.toThrow(UnauthorizedException)
  })
})

describe('troca de senha', () => {
  it('senha atual errada dá 400 "Senha atual incorreta"', async () => {
    const { auth } = await setup()
    await expect(auth.changePassword('u-1', { currentPassword: 'errada', newPassword: 'senha-nova-123' })).rejects.toThrow(
      new BadRequestException('Senha atual incorreta'),
    )
  })

  it('nova senha igual à atual dá 400', async () => {
    const { auth } = await setup()
    await expect(
      auth.changePassword('u-1', { currentPassword: 'senha-antiga', newPassword: 'senha-antiga' }),
    ).rejects.toThrow(BadRequestException)
  })

  it('grava o hash novo (a senha nova passa a valer no login)', async () => {
    const { auth, rows } = await setup()
    await auth.changePassword('u-1', { currentPassword: 'senha-antiga', newPassword: 'senha-nova-123' })
    expect(await bcrypt.compare('senha-nova-123', rows[0].passwordHash)).toBe(true)
    await expect(auth.login({ email: 'carla@x.com', password: 'senha-nova-123' })).resolves.toHaveProperty('accessToken')
  })

  it('a sexta tentativa na mesma hora dá 429', async () => {
    const { auth } = await setup()
    for (let i = 0; i < 5; i++) {
      await expect(auth.changePassword('u-1', { currentPassword: 'errada', newPassword: 'senha-nova-123' })).rejects.toThrow(
        BadRequestException,
      )
    }
    const attempt = auth.changePassword('u-1', { currentPassword: 'senha-antiga', newPassword: 'senha-nova-123' })
    await expect(attempt).rejects.toThrow(HttpException)
    await attempt.catch((error: HttpException) => expect(error.getStatus()).toBe(429))
  })

  it('a janela de uma hora libera de novo', () => {
    const limiter = new PasswordAttempts()
    const start = Date.now()
    for (let i = 0; i < 5; i++) limiter.hit('u-1', start)
    expect(() => limiter.hit('u-1', start + 1000)).toThrow(HttpException)
    expect(() => limiter.hit('u-1', start + 60 * 60 * 1000 + 1)).not.toThrow()
    // Contador por usuário
    expect(() => limiter.hit('u-2', start)).not.toThrow()
  })
})

describe('perfil próprio', () => {
  it('GET devolve dados, nome da equipe e da organização, sem o hash', async () => {
    const { auth } = await setup()
    const profile = await auth.getProfile('u-1')
    expect(profile).toMatchObject({ id: 'u-1', name: 'Carla', role: 'corretor', teamName: null, organizationName: 'Imob Teste' })
  })

  it('telefone vira (DD) 9XXXX-XXXX; vazio limpa; inválido dá 400', async () => {
    const { auth, rows } = await setup()
    await auth.updateProfile('u-1', { phone: '+55 11 98765-4321' })
    expect(rows[0].phone).toBe('(11) 98765-4321')
    await auth.updateProfile('u-1', { phone: '1133334444' })
    expect(rows[0].phone).toBe('(11) 3333-4444')
    await auth.updateProfile('u-1', { phone: '' })
    expect(rows[0].phone).toBeNull()
    await expect(auth.updateProfile('u-1', { phone: '1234' })).rejects.toThrow(BadRequestException)
  })

  it('nome vazio dá 400; CRECI vazio limpa', async () => {
    const { auth, rows } = await setup()
    await expect(auth.updateProfile('u-1', { name: '   ' })).rejects.toThrow(BadRequestException)
    await auth.updateProfile('u-1', { name: '  Carla Souza ', creci: ' 12345-F ' })
    expect(rows[0]).toMatchObject({ name: 'Carla Souza', creci: '12345-F' })
    await auth.updateProfile('u-1', { creci: '' })
    expect(rows[0].creci).toBeNull()
  })

  it('o serviço só mexe em nome, telefone e CRECI', async () => {
    const { auth, db } = await setup()
    await auth.updateProfile('u-1', { name: 'Carla' })
    const call = db.user.update.mock.calls.at(-1)?.[0]
    expect(Object.keys(call?.data ?? {})).toEqual(['name'])
  })
})

describe('e-mail normalizado', () => {
  it('cadastrar com " Joao@Teste.com " e entrar com joao@teste.com', async () => {
    const { users, auth, rows } = await setup()
    const diretor = { id: 'd-1', role: 'diretor', organizationId: ORG, teamId: null }
    await users.create(diretor, { name: 'João', email: ' Joao@Teste.com ', password: 'senha-do-joao', role: 'corretor' })
    expect(rows.at(-1)?.email).toBe('joao@teste.com')
    await expect(auth.login({ email: 'joao@teste.com', password: 'senha-do-joao' })).resolves.toHaveProperty('accessToken')
    await expect(auth.login({ email: ' JOAO@teste.COM ', password: 'senha-do-joao' })).resolves.toHaveProperty('accessToken')
  })

  it('a senha não passa por trim', async () => {
    const { users, auth } = await setup()
    const diretor = { id: 'd-1', role: 'diretor', organizationId: ORG, teamId: null }
    await users.create(diretor, { name: 'Ana', email: 'ana@x.com', password: ' com-espaco ', role: 'corretor' })
    await expect(auth.login({ email: 'ana@x.com', password: 'com-espaco' })).rejects.toThrow(UnauthorizedException)
    await expect(auth.login({ email: 'ana@x.com', password: ' com-espaco ' })).resolves.toHaveProperty('accessToken')
  })

  it('conta antiga gravada com maiúsculas ainda entra', async () => {
    const { auth, rows } = await setup()
    rows[0].email = 'Carla@X.com'
    await expect(auth.login({ email: 'carla@x.com', password: 'senha-antiga' })).resolves.toHaveProperty('accessToken')
  })

  it('e-mail já cadastrado com outra caixa dá 409', async () => {
    const { users } = await setup()
    const diretor = { id: 'd-1', role: 'diretor', organizationId: ORG, teamId: null }
    await expect(
      users.create(diretor, { name: 'Outra', email: 'CARLA@x.com', role: 'corretor' }),
    ).rejects.toThrow('Email já cadastrado')
  })
})

describe('log do login', () => {
  it('registra só o motivo e o e-mail normalizado, nunca a senha; a resposta é genérica', async () => {
    const { auth } = await setup()
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const attempts: [string, string, string][] = [
      ['ninguem@x.com', 'segredo-1', 'usuario_nao_encontrado'],
      [' Carla@X.com ', 'segredo-2', 'senha_incorreta'],
    ]
    for (const [email, password, reason] of attempts) {
      await expect(auth.login({ email, password })).rejects.toThrow(new UnauthorizedException('Credenciais inválidas'))
      const message = String(warn.mock.calls.at(-1)?.[0])
      expect(message).toContain(`motivo=${reason}`)
      expect(message).toContain(`email=${email.trim().toLowerCase()}`)
      expect(message).not.toContain(password)
    }
    warn.mockRestore()
  })

  it('usuário inativo: motivo inativo', async () => {
    const { auth, rows } = await setup()
    rows[0].active = false
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    await expect(auth.login({ email: 'carla@x.com', password: 'senha-antiga' })).rejects.toThrow(UnauthorizedException)
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('motivo=inativo')
    warn.mockRestore()
  })
})
