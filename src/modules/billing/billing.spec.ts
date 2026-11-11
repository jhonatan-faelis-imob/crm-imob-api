import { BadRequestException, ForbiddenException, HttpException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { PrismaService } from '../../prisma/prisma.service'
import { AdminService } from '../admin/admin.service'
import type { AuthService } from '../auth/auth.service'
import { ALLOW_WHEN_BLOCKED_KEY } from '../../common/decorators/allow-when-blocked.decorator'
import { UsersService } from '../users/users.service'
import { isValidCnpj, isValidCpf, isValidDocument } from './document'
import { GRACE_DAYS, priceFor } from './plans.config'
import type { SubscriptionCache } from './subscription-cache'
import { addMonths, nextStatus, periodEndAfterPayment, subscriptionWarning } from './subscription-state'
import { SubscriptionGuard } from './subscription.guard'
import { SuperAdminGuard } from './super-admin'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-11T12:00:00.000Z')
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY)

function statusOf(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : null
}

// ---------------------------------------------------------------- planos

describe('priceFor', () => {
  it.each([
    ['corretor', 1, 89.9],
    ['corretor', 3, 89.9], // Corretor não vende assento extra
    ['equipe', 5, 247],
    ['equipe', 8, 247 + 3 * 30],
    ['equipe', 2, 247], // abaixo do incluído não dá desconto
    ['imobiliaria', 20, 699],
    ['imobiliaria', 25, 699 + 5 * 30],
  ])('%s com %i assentos custa %f', (plan, seats, price) => {
    expect(priceFor(plan, seats)).toBe(price)
  })

  it('plano desconhecido devolve null', () => expect(priceFor('pro', 5)).toBeNull())
})

// ---------------------------------------------------------------- CPF e CNPJ

describe('CPF e CNPJ', () => {
  it.each(['529.982.247-25', '52998224725', '111.444.777-35'])('CPF válido %s', (cpf) => {
    expect(isValidCpf(cpf)).toBe(true)
    expect(isValidDocument(cpf)).toBe(true)
  })
  it.each(['529.982.247-24', '111.111.111-11', '1234567890', ''])('CPF inválido %s', (cpf) => {
    expect(isValidCpf(cpf)).toBe(false)
  })
  it.each(['11.222.333/0001-81', '11222333000181', '45.723.174/0001-10'])('CNPJ válido %s', (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true)
    expect(isValidDocument(cnpj)).toBe(true)
  })
  it.each(['11.222.333/0001-80', '00.000.000/0000-00', '112223330001'])('CNPJ inválido %s', (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(false)
  })
  it('documento com tamanho de nenhum dos dois é inválido', () => expect(isValidDocument('123456789012')).toBe(false))
})

// ---------------------------------------------------------------- guard de assinatura

function httpContext(method: string, organizationId = 'org-1'): ExecutionContext {
  const request = { method, user: { organizationId } }
  return {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

function guardFor(status: string, allowWhenBlocked = false) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === ALLOW_WHEN_BLOCKED_KEY ? allowWhenBlocked : false),
  } as unknown as Reflector
  const cache = {
    get: jest.fn(() => Promise.resolve({ subscriptionStatus: status, trialEndsAt: null, currentPeriodEnd: null })),
  }
  return { guard: new SubscriptionGuard(reflector, cache as unknown as SubscriptionCache), cache }
}

describe('SubscriptionGuard', () => {
  it.each(['bloqueada', 'cancelada'])('%s: leitura passa', async (status) => {
    const { guard } = guardFor(status)
    await expect(guard.canActivate(httpContext('GET'))).resolves.toBe(true)
  })

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('bloqueada: %s dá 402 SUBSCRIPTION_BLOCKED', async (method) => {
    const { guard } = guardFor('bloqueada')
    const error = await guard.canActivate(httpContext(method)).catch((caught: unknown) => caught)
    expect(statusOf(error)).toBe(402)
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'SUBSCRIPTION_BLOCKED' })
  })

  it.each(['teste', 'ativa', 'atrasada'])('%s: escrita passa', async (status) => {
    const { guard } = guardFor(status)
    await expect(guard.canActivate(httpContext('POST'))).resolves.toBe(true)
  })

  it('rota marcada com @AllowWhenBlocked passa mesmo bloqueada, sem consultar a organização', async () => {
    const { guard, cache } = guardFor('bloqueada', true)
    await expect(guard.canActivate(httpContext('POST'))).resolves.toBe(true)
    expect(cache.get).not.toHaveBeenCalled()
  })

  it('leitura não consulta a organização', async () => {
    const { guard, cache } = guardFor('bloqueada')
    await guard.canActivate(httpContext('GET'))
    expect(cache.get).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- superadministrador

describe('SuperAdminGuard', () => {
  const original = process.env.SUPER_ADMIN_EMAILS
  afterEach(() => {
    process.env.SUPER_ADMIN_EMAILS = original
  })
  const context = (email: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user: { email } }) }) }) as unknown as ExecutionContext

  it('e-mail de fora dá 403', () => {
    process.env.SUPER_ADMIN_EMAILS = 'dono@crm.com, socio@crm.com'
    expect(() => new SuperAdminGuard().canActivate(context('diretor@imob.com'))).toThrow(ForbiddenException)
  })

  it('e-mail da lista passa, sem diferença de caixa e espaços', () => {
    process.env.SUPER_ADMIN_EMAILS = ' Dono@CRM.com ,socio@crm.com'
    expect(new SuperAdminGuard().canActivate(context('dono@crm.com'))).toBe(true)
  })

  it('lista vazia: ninguém passa', () => {
    process.env.SUPER_ADMIN_EMAILS = ''
    expect(() => new SuperAdminGuard().canActivate(context(''))).toThrow(ForbiddenException)
  })
})

// ---------------------------------------------------------------- limite de assentos

function seatSetup(seats: number, users: { id: string; active: boolean; role?: string }[]) {
  const rows = users.map((user) => ({
    name: user.id, email: `${user.id}@x.com`, role: user.role ?? 'corretor', teamId: null, organizationId: 'org-1', ...user,
  }))
  const prisma = {
    organization: { findUnique: jest.fn(() => Promise.resolve({ seats, plan: 'equipe' })) },
    user: {
      count: jest.fn(({ where }: { where: { active: boolean } }) =>
        Promise.resolve(rows.filter((row) => row.active === where.active).length),
      ),
      findFirst: jest.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? (rows.find((row) => row.id === where.id) ?? null) : null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'novo', ...data })),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve(data)),
    },
    team: { findFirst: jest.fn(() => Promise.resolve(null)), updateMany: jest.fn() },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  const auth = { hashPassword: jest.fn(() => Promise.resolve('hash')) }
  const service = new UsersService(prisma as unknown as PrismaService, auth as unknown as AuthService)
  return { service, prisma }
}

const diretor = { id: 'd-1', role: 'diretor', organizationId: 'org-1', teamId: null }
const newUser = { name: 'Nova', email: 'nova@x.com', role: 'corretor' }

describe('limite de assentos', () => {
  it('com um assento livre, cria', async () => {
    const { service } = seatSetup(5, [{ id: 'a', active: true }, { id: 'b', active: true }, { id: 'c', active: true }, { id: 'd', active: true }])
    await expect(service.create(diretor, newUser)).resolves.toHaveProperty('id')
  })

  it('no limite exato, 402 SEAT_LIMIT com o plano na mensagem', async () => {
    const { service, prisma } = seatSetup(2, [{ id: 'a', active: true }, { id: 'b', active: true }])
    const error = await service.create(diretor, newUser).catch((caught: unknown) => caught)
    expect(statusOf(error)).toBe(402)
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'SEAT_LIMIT',
      message: 'Limite de 2 usuários do plano Equipe atingido. Fale com o suporte para ampliar.',
    })
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('inativos não ocupam assento', async () => {
    const { service } = seatSetup(2, [{ id: 'a', active: true }, { id: 'b', active: false }])
    await expect(service.create(diretor, newUser)).resolves.toHaveProperty('id')
  })

  it('reativar no limite dá 402; com assento livre, reativa', async () => {
    const full = seatSetup(1, [{ id: 'a', active: true }, { id: 'b', active: false }])
    const error = await full.service.update(diretor, 'b', { active: true }).catch((caught: unknown) => caught)
    expect(statusOf(error)).toBe(402)

    const free = seatSetup(2, [{ id: 'a', active: true }, { id: 'b', active: false }])
    await expect(free.service.update(diretor, 'b', { active: true })).resolves.toMatchObject({ active: true })
  })

  it('desativar e editar quem já está ativo não conta assento', async () => {
    const { service, prisma } = seatSetup(1, [{ id: 'a', active: true }, { id: 'b', active: true }])
    await service.update(diretor, 'b', { active: false })
    await service.update(diretor, 'a', { name: 'Outro nome', active: true })
    expect(prisma.organization.findUnique).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- situação: regras puras

describe('nextStatus (tarefa diária)', () => {
  const snapshot = (subscriptionStatus: string, trialEndsAt: Date | null, currentPeriodEnd: Date | null) => ({
    subscriptionStatus, trialEndsAt, currentPeriodEnd,
  })

  it('teste vencido vira atrasada; dentro do prazo não muda', () => {
    expect(nextStatus(snapshot('teste', daysFromNow(-1), null), NOW)?.status).toBe('atrasada')
    expect(nextStatus(snapshot('teste', daysFromNow(2), null), NOW)).toBeNull()
  })

  it('ativa com período vencido vira atrasada', () => {
    expect(nextStatus(snapshot('ativa', null, daysFromNow(-1)), NOW)?.status).toBe('atrasada')
    expect(nextStatus(snapshot('ativa', null, daysFromNow(10)), NOW)).toBeNull()
    expect(nextStatus(snapshot('ativa', null, null), NOW)).toBeNull()
  })

  it(`atrasada há mais de ${GRACE_DAYS} dias vira bloqueada`, () => {
    expect(nextStatus(snapshot('atrasada', null, daysFromNow(-(GRACE_DAYS + 1))), NOW)?.status).toBe('bloqueada')
    expect(nextStatus(snapshot('atrasada', null, daysFromNow(-(GRACE_DAYS - 1))), NOW)).toBeNull()
    // Teste vencido que virou atrasada: conta do fim do teste
    expect(nextStatus(snapshot('atrasada', daysFromNow(-(GRACE_DAYS + 2)), null), NOW)?.status).toBe('bloqueada')
    // Marcada à mão, sem data: não bloqueia sozinha
    expect(nextStatus(snapshot('atrasada', null, null), NOW)).toBeNull()
  })

  it('bloqueada e cancelada não mudam', () => {
    expect(nextStatus(snapshot('bloqueada', null, daysFromNow(-60)), NOW)).toBeNull()
    expect(nextStatus(snapshot('cancelada', null, daysFromNow(-60)), NOW)).toBeNull()
  })
})

describe('aviso da faixa do topo', () => {
  it('teste terminando em N dias', () => {
    expect(subscriptionWarning({ subscriptionStatus: 'teste', trialEndsAt: daysFromNow(3), currentPeriodEnd: null }, NOW)).toEqual({
      warning: 'Seu período de teste termina em 3 dias.',
      level: 'aviso',
    })
  })
  it('atrasada avisa quantos dias faltam para o bloqueio', () => {
    const notice = subscriptionWarning({ subscriptionStatus: 'atrasada', trialEndsAt: null, currentPeriodEnd: daysFromNow(-2) }, NOW)
    expect(notice).toEqual({ warning: `Assinatura em atraso. Regularize para evitar o bloqueio em ${GRACE_DAYS - 2} dias.`, level: 'aviso' })
  })
  it('bloqueada', () => {
    expect(subscriptionWarning({ subscriptionStatus: 'bloqueada', trialEndsAt: null, currentPeriodEnd: null }, NOW)).toEqual({
      warning: 'Assinatura bloqueada. O sistema está somente leitura.',
      level: 'bloqueio',
    })
  })
  it('ativa: sem aviso', () => {
    expect(subscriptionWarning({ subscriptionStatus: 'ativa', trialEndsAt: null, currentPeriodEnd: daysFromNow(10) }, NOW)).toBeNull()
  })
})

describe('vencimento depois do pagamento', () => {
  it('vencido: um mês a partir de hoje', () => {
    expect(periodEndAfterPayment(new Date('2026-10-20T12:00:00.000Z'), NOW).toISOString()).toBe('2026-12-11T12:00:00.000Z')
  })
  it('a vencer: um mês a partir do vencimento atual', () => {
    expect(periodEndAfterPayment(new Date('2026-11-25T12:00:00.000Z'), NOW).toISOString()).toBe('2026-12-25T12:00:00.000Z')
  })
  it('sem vencimento: um mês a partir de hoje', () => {
    expect(periodEndAfterPayment(null, NOW).toISOString()).toBe('2026-12-11T12:00:00.000Z')
  })
  it('fim de mês não pula o mês seguinte', () => {
    expect(addMonths(new Date('2027-01-31T12:00:00.000Z'), 1).toISOString()).toBe('2027-02-28T12:00:00.000Z')
  })
})

// ---------------------------------------------------------------- painel /admin

type OrgRow = {
  id: string
  name: string
  plan: string
  seats: number
  subscriptionStatus: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
  monthlyPrice: number | null
}

function adminSetup(organizations: OrgRow[], activeUsers = 0) {
  const events: { organizationId: string; kind: string; description: string; createdBy: string }[] = []
  const prisma = {
    organization: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        // Cópia, como o Prisma: o update não pode mexer no "current" já lido
        const row = organizations.find((item) => item.id === where.id)
        return Promise.resolve(row ? { ...row } : null)
      }),
      findMany: jest.fn(({ where }: { where: { subscriptionStatus: { in: string[] } } }) =>
        Promise.resolve(organizations.filter((row) => where.subscriptionStatus.in.includes(row.subscriptionStatus))),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<OrgRow> }) => {
        const row = organizations.find((item) => item.id === where.id)
        Object.assign(row ?? {}, data)
        return Promise.resolve(row)
      }),
    },
    user: { count: jest.fn(() => Promise.resolve(activeUsers)) },
    billingEvent: {
      create: jest.fn(({ data }: { data: (typeof events)[number] }) => {
        events.push(data)
        return Promise.resolve(data)
      }),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  const cache = { invalidate: jest.fn() }
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as AuthService,
    cache as unknown as SubscriptionCache,
  )
  return { service, prisma, events, cache }
}

const org = (id: string, subscriptionStatus: string, trialEndsAt: Date | null, currentPeriodEnd: Date | null): OrgRow => ({
  id, name: `Imob ${id}`, plan: 'equipe', seats: 5, subscriptionStatus, trialEndsAt, currentPeriodEnd, monthlyPrice: 247,
})

describe('AdminService.recalculateSubscriptionStatuses', () => {
  it('aplica as três transições, grava evento em cada uma e limpa o cache', async () => {
    const rows = [
      org('teste-vencido', 'teste', daysFromNow(-1), null),
      org('ativa-vencida', 'ativa', null, daysFromNow(-1)),
      org('atrasada-velha', 'atrasada', null, daysFromNow(-(GRACE_DAYS + 1))),
      org('em-dia', 'ativa', null, daysFromNow(20)),
    ]
    const { service, events, cache } = adminSetup(rows)
    const result = await service.recalculateSubscriptionStatuses('dono@crm.com', NOW)

    expect(rows.map((row) => row.subscriptionStatus)).toEqual(['atrasada', 'atrasada', 'bloqueada', 'ativa'])
    expect(result).toMatchObject({ checked: 4, changed: 3 })
    expect(events.map((event) => event.kind)).toEqual(['observacao', 'observacao', 'bloqueada'])
    expect(events.every((event) => event.createdBy === 'dono@crm.com')).toBe(true)
    expect(cache.invalidate).toHaveBeenCalledTimes(3)
  })
})

describe('AdminService.update', () => {
  it('assentos abaixo dos usuários ativos dá 400', async () => {
    const { service, prisma } = adminSetup([org('o1', 'ativa', null, null)], 4)
    await expect(service.update('o1', { seats: 3 }, 'dono@crm.com')).rejects.toThrow(BadRequestException)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it('assentos iguais aos ativos passa, com evento de plano alterado', async () => {
    const { service, events } = adminSetup([org('o1', 'ativa', null, null)], 4)
    await service.update('o1', { plan: 'imobiliaria', seats: 4 }, 'dono@crm.com')
    expect(events[0]).toMatchObject({ kind: 'plano_alterado', createdBy: 'dono@crm.com' })
  })
})

describe('AdminService.registerPayment', () => {
  it('vencido: vencimento um mês a partir de hoje e volta para ativa', async () => {
    const rows = [org('o1', 'bloqueada', null, new Date('2026-10-20T12:00:00.000Z'))]
    const { service, events, cache } = adminSetup(rows)
    await service.registerPayment('o1', { amount: 247, paidAt: '2026-11-11', method: 'pix' }, 'dono@crm.com', NOW)
    expect(rows[0]).toMatchObject({ subscriptionStatus: 'ativa', currentPeriodEnd: new Date('2026-12-11T12:00:00.000Z') })
    expect(events[0]).toMatchObject({ kind: 'pagamento_registrado' })
    expect(cache.invalidate).toHaveBeenCalledWith('o1')
  })

  it('a vencer: vencimento um mês a partir do vencimento atual', async () => {
    const rows = [org('o1', 'ativa', null, new Date('2026-11-25T12:00:00.000Z'))]
    const { service } = adminSetup(rows)
    await service.registerPayment('o1', { amount: 247, paidAt: '2026-11-11', method: 'boleto' }, 'dono@crm.com', NOW)
    expect(rows[0].currentPeriodEnd).toEqual(new Date('2026-12-25T12:00:00.000Z'))
  })
})
