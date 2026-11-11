import { BadRequestException, ConflictException, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Prisma } from '@prisma/client'
import request from 'supertest'
import { createTestApp } from '../../../common/testing/test-app'
import type { PrismaService } from '../../../prisma/prisma.service'
import { AdminService } from '../../admin/admin.service'
import type { AuthService } from '../../auth/auth.service'
import type { SubscriptionCache } from '../subscription-cache'
import { AsaasBillingService } from './asaas-billing.service'
import { AsaasWebhookService, isValidWebhookToken } from './asaas-webhook.service'
import { AsaasClient } from './asaas.client'
import type { AsaasPayment, AsaasWebhookEvent } from './asaas.types'

const ORG = '11111111-2222-4333-8444-555555555555'
const API_KEY = '$aact_chave_secreta_de_teste_123456'
const WEBHOOK_TOKEN = 'token-do-webhook-com-mais-de-32-caracteres'
const NOW = new Date('2026-11-12T12:00:00.000Z')

// ---------------------------------------------------------------- banco em memória

type Row = Record<string, unknown>

function makeDb(organization: Row, activeUsers = 1) {
  const organizations: Row[] = [organization]
  const payments: Row[] = []
  const deliveries: Row[] = []
  const events: Row[] = []

  const byProviderEvent = (where: { provider_eventId?: { provider: string; eventId: string } }) =>
    deliveries.find((row) => row.provider === where.provider_eventId?.provider && row.eventId === where.provider_eventId?.eventId)

  const db = {
    organization: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const row = organizations.find((item) => item.id === where.id)
        return Promise.resolve(row ? { ...row } : null)
      }),
      findFirst: jest.fn(({ where }: { where: Row }) => {
        const row = organizations.find((item) => Object.entries(where).every(([key, value]) => item[key] === value))
        return Promise.resolve(row ? { ...row } : null)
      }),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Row }) => {
        const row = organizations.find((item) => item.id === where.id)
        Object.assign(row ?? {}, data)
        return Promise.resolve(row)
      }),
    },
    user: { count: jest.fn(() => Promise.resolve(activeUsers)) },
    payment: {
      findUnique: jest.fn(({ where }: { where: { asaasPaymentId: string } }) =>
        Promise.resolve(payments.find((row) => row.asaasPaymentId === where.asaasPaymentId) ?? null),
      ),
      upsert: jest.fn(({ where, create, update }: { where: { asaasPaymentId: string }; create: Row; update: Row }) => {
        const row = payments.find((item) => item.asaasPaymentId === where.asaasPaymentId)
        if (row) Object.assign(row, update)
        else payments.push({ ...create })
        return Promise.resolve(row)
      }),
      findMany: jest.fn(() => Promise.resolve(payments)),
    },
    webhookDelivery: {
      findUnique: jest.fn(({ where }: { where: { provider_eventId: { provider: string; eventId: string } } }) =>
        Promise.resolve(byProviderEvent(where) ?? null),
      ),
      create: jest.fn(({ data }: { data: Row }) => {
        if (byProviderEvent({ provider_eventId: { provider: String(data.provider), eventId: String(data.eventId) } })) {
          return Promise.reject(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }))
        }
        deliveries.push({ ...data })
        return Promise.resolve(data)
      }),
      update: jest.fn(({ where, data }: { where: { provider_eventId: { provider: string; eventId: string } }; data: Row }) => {
        Object.assign(byProviderEvent(where) ?? {}, data)
        return Promise.resolve(data)
      }),
      upsert: jest.fn(({ where, create, update }: { where: { provider_eventId: { provider: string; eventId: string } }; create: Row; update: Row }) => {
        const row = byProviderEvent(where)
        if (row) Object.assign(row, update)
        else deliveries.push({ ...create })
        return Promise.resolve(row)
      }),
    },
    billingEvent: {
      create: jest.fn(({ data }: { data: Row }) => {
        events.push(data)
        return Promise.resolve(data)
      }),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return { db, organizations, payments, deliveries, events, prisma: db as unknown as PrismaService }
}

const baseOrg = (overrides: Row = {}): Row => ({
  id: ORG,
  name: 'Imob Teste',
  plan: 'corretor',
  seats: 1,
  subscriptionStatus: 'teste',
  trialEndsAt: new Date('2026-11-20T12:00:00.000Z'),
  currentPeriodEnd: null,
  monthlyPrice: null,
  billingName: 'Imob Teste Ltda',
  billingDocument: '11222333000181',
  billingEmail: 'financeiro@imob.com',
  billingPhone: '(11) 98765-4321',
  asaasCustomerId: null,
  asaasSubscriptionId: null,
  billingType: null,
  canceledAt: null,
  cancelReason: null,
  ...overrides,
})

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService
}

const cache = { invalidate: jest.fn() } as unknown as SubscriptionCache

// ---------------------------------------------------------------- Asaas simulado (fetch falso)

type Call = { method: string; url: string; headers: Record<string, string>; body: Record<string, unknown> | null }

function fakeAsaas(responses: Partial<Record<string, (call: Call) => { status: number; body: unknown }>> = {}) {
  const calls: Call[] = []
  const client = new AsaasClient(config({ ASAAS_API_KEY: API_KEY, ASAAS_ENV: 'sandbox' }))
  client.sleep = () => Promise.resolve()
  client.fetcher = (url, init) => {
    const call: Call = {
      method: String(init.method),
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    }
    calls.push(call)
    const path = url.replace('https://api-sandbox.asaas.com/v3', '')
    const key = `${call.method} ${path.replace(/\/(cus|sub)_[^/]+/, '/:id')}`
    const handler = responses[key]
    const { status, body } = handler
      ? handler(call)
      : key === 'POST /customers'
        ? { status: 200, body: { id: 'cus_000001', name: 'Imob' } }
        : key === 'POST /subscriptions'
          ? { status: 200, body: { id: 'sub_000001', customer: 'cus_000001', status: 'ACTIVE', value: call.body?.value } }
          : key === 'GET /subscriptions/:id/payments'
            ? { status: 200, body: { object: 'list', hasMore: false, totalCount: 1, limit: 10, offset: 0, data: [payment({ status: 'PENDING' })] } }
            : { status: 200, body: { id: 'sub_000001', deleted: true } }
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { client, calls }
}

function payment(overrides: Partial<AsaasPayment> = {}): AsaasPayment {
  return {
    id: 'pay_000001',
    customer: 'cus_000001',
    subscription: 'sub_000001',
    value: 307,
    netValue: 300.5,
    status: 'CONFIRMED',
    billingType: 'CREDIT_CARD',
    dueDate: '2026-11-20',
    paymentDate: '2026-11-12',
    invoiceUrl: 'https://sandbox.asaas.com/i/000001',
    externalReference: null,
    ...overrides,
  }
}

function billingSetup(org: Row, activeUsers = 1, responses?: Parameters<typeof fakeAsaas>[0]) {
  const memory = makeDb(org, activeUsers)
  const asaas = fakeAsaas(responses)
  const service = new AsaasBillingService(memory.prisma, asaas.client, cache, config({ APP_PUBLIC_URL: 'https://app.smartcrm.com.br/' }))
  return { ...memory, ...asaas, service }
}

const director = { organizationId: ORG, email: 'diretor@imob.com' }

// ---------------------------------------------------------------- assinar

describe('POST /billing/subscribe', () => {
  it('Equipe com 7 usuários envia R$ 307 ao Asaas, mensal, com a referência da organização e o retorno', async () => {
    const { service, calls, organizations } = billingSetup(baseOrg())
    const result = await service.subscribe(director, { planId: 'equipe', seats: 7, billingType: 'CREDIT_CARD' }, NOW)

    const created = calls.find((call) => call.method === 'POST' && call.url.endsWith('/subscriptions'))
    expect(created?.body).toMatchObject({
      customer: 'cus_000001',
      billingType: 'CREDIT_CARD',
      value: 307,
      cycle: 'MONTHLY',
      // Em teste: o primeiro vencimento é o fim do teste
      nextDueDate: '2026-11-20',
      description: 'Smart CRM — plano Equipe (7 usuários)',
      externalReference: ORG,
      callback: { successUrl: 'https://app.smartcrm.com.br/assinatura/retorno', autoRedirect: true },
    })
    expect(result).toEqual({ redirectUrl: 'https://sandbox.asaas.com/i/000001', subscriptionId: 'sub_000001' })
    // A situação não muda: quem libera é o webhook
    expect(organizations[0]).toMatchObject({ subscriptionStatus: 'teste', plan: 'equipe', seats: 7, asaasSubscriptionId: 'sub_000001' })
  })

  it('cria o cliente com os dados de cobrança (celular em mobilePhone) e guarda o id', async () => {
    const { service, calls, organizations } = billingSetup(baseOrg())
    await service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW)
    const customer = calls.find((call) => call.method === 'POST' && call.url.endsWith('/customers'))
    expect(customer?.body).toEqual({
      name: 'Imob Teste Ltda',
      cpfCnpj: '11222333000181',
      email: 'financeiro@imob.com',
      mobilePhone: '11987654321',
      externalReference: ORG,
    })
    expect(organizations[0].asaasCustomerId).toBe('cus_000001')
  })

  it('cliente já existente é atualizado, não recriado', async () => {
    const { service, calls } = billingSetup(baseOrg({ asaasCustomerId: 'cus_existente' }))
    await service.subscribe(director, { planId: 'corretor', billingType: 'BOLETO' }, NOW)
    expect(calls.some((call) => call.method === 'PUT' && call.url.endsWith('/customers/cus_existente'))).toBe(true)
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/customers'))).toBe(false)
  })

  it('assinar duas vezes dá 409', async () => {
    const { service } = billingSetup(baseOrg())
    await service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW)
    await expect(service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW)).rejects.toThrow(
      new ConflictException('Já existe uma assinatura ativa'),
    )
  })

  it('sem dados de cobrança dá 400 dizendo o que falta, sem chamar o Asaas', async () => {
    const { service, calls } = billingSetup(baseOrg({ billingDocument: null, billingPhone: null }))
    await expect(service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW)).rejects.toThrow(
      new BadRequestException('Preencha os dados de cobrança: CPF ou CNPJ, telefone.'),
    )
    expect(calls).toHaveLength(0)
  })

  it('Corretor com 2 usuários é rejeitado antes de chamar o Asaas', async () => {
    const { service, calls } = billingSetup(baseOrg())
    await expect(service.subscribe(director, { planId: 'corretor', seats: 2, billingType: 'PIX' }, NOW)).rejects.toThrow(
      BadRequestException,
    )
    expect(calls).toHaveLength(0)
  })

  it('menos usuários que os ativos dá 400 explicando quantos desativar', async () => {
    const { service } = billingSetup(baseOrg(), 4)
    await expect(service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW)).rejects.toThrow(
      'Você tem 4 usuários ativos. Desative 3 usuários antes ou escolha mais usuários.',
    )
  })

  it('erro do Asaas (4xx) vira 400 com a mensagem deles, sem a chave', async () => {
    const { service } = billingSetup(baseOrg(), 1, {
      'POST /customers': () => ({ status: 400, body: { errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }] } }),
    })
    const error = await service.subscribe(director, { planId: 'corretor', billingType: 'PIX' }, NOW).catch((caught: Error) => caught)
    expect(error).toBeInstanceOf(BadRequestException)
    expect(error.message).toBe('Asaas: O CPF/CNPJ informado é inválido.')
    expect(error.message).not.toContain(API_KEY)
  })
})

// ---------------------------------------------------------------- trocar plano e cancelar

describe('PATCH /billing/subscription e cancelamento', () => {
  const active = () => baseOrg({ subscriptionStatus: 'ativa', plan: 'equipe', seats: 5, asaasCustomerId: 'cus_000001', asaasSubscriptionId: 'sub_000001', currentPeriodEnd: new Date('2026-12-05T12:00:00.000Z') })

  it('troca de plano manda o valor novo para a próxima cobrança e grava plano, usuários e valor', async () => {
    const { service, calls, organizations, events } = billingSetup(active(), 3)
    await service.changeSubscription(director, { planId: 'imobiliaria', seats: 22 })
    const put = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/subscriptions/sub_000001'))
    expect(put?.body).toEqual({ value: 759, description: 'Smart CRM — plano Imobiliária (22 usuários)', updatePendingPayments: true })
    expect(organizations[0]).toMatchObject({ plan: 'imobiliaria', seats: 22, monthlyPrice: 759 })
    expect(events[0]).toMatchObject({ kind: 'plano_alterado' })
  })

  it('não deixa os usuários abaixo dos ativos', async () => {
    const { service, calls } = billingSetup(active(), 6)
    await expect(service.changeSubscription(director, { seats: 5 })).rejects.toThrow(BadRequestException)
    await expect(service.changeSubscription(director, { planId: 'corretor' })).rejects.toThrow(BadRequestException)
    expect(calls).toHaveLength(0)
  })

  it('Corretor com 2 usuários na troca é rejeitado', async () => {
    const { service } = billingSetup(active(), 1)
    await expect(service.changeSubscription(director, { planId: 'corretor', seats: 2 })).rejects.toThrow(BadRequestException)
  })

  it('cancelar remove no Asaas e mantém ativa até o fim do período; depois a tarefa diária cancela', async () => {
    const { service, calls, organizations, prisma } = billingSetup(active(), 3)
    const result = await service.cancel(director, { reason: 'Vou fechar a imobiliária' }, NOW)
    expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/subscriptions/sub_000001'))).toBe(true)
    expect(organizations[0]).toMatchObject({ subscriptionStatus: 'ativa', canceledAt: NOW, cancelReason: 'Vou fechar a imobiliária' })
    expect(result.accessUntil).toEqual(new Date('2026-12-05T12:00:00.000Z'))

    // Tarefa diária: antes do fim do período nada muda; depois, cancelada
    const admin = new AdminService(
      { ...prisma, organization: { ...(prisma as unknown as { organization: object }).organization, findMany: jest.fn(() => Promise.resolve(organizations)) } } as unknown as PrismaService,
      {} as AuthService,
      cache,
    )
    await admin.recalculateSubscriptionStatuses('sistema', new Date('2026-12-01T12:00:00.000Z'))
    expect(organizations[0].subscriptionStatus).toBe('ativa')
    await admin.recalculateSubscriptionStatuses('sistema', new Date('2026-12-06T12:00:00.000Z'))
    expect(organizations[0].subscriptionStatus).toBe('cancelada')
  })

  it('depois de cancelar, dá para assinar de novo', async () => {
    const { service } = billingSetup(active(), 3)
    await service.cancel(director, { reason: 'Troca de forma de pagamento' }, NOW)
    await expect(service.subscribe(director, { planId: 'equipe', billingType: 'PIX' }, NOW)).resolves.toHaveProperty('subscriptionId')
  })
})

// ---------------------------------------------------------------- webhook

function webhookSetup(org: Row = baseOrg({ asaasCustomerId: 'cus_000001', asaasSubscriptionId: 'sub_000001' })) {
  const memory = makeDb(org)
  const service = new AsaasWebhookService(memory.prisma, cache, config({ ASAAS_WEBHOOK_TOKEN: WEBHOOK_TOKEN }))
  return { ...memory, service }
}

const paymentEvent = (event: string, overrides: Partial<AsaasPayment> = {}, id = `evt_${event}_1`): AsaasWebhookEvent => ({
  id,
  event,
  dateCreated: '2026-11-12 10:00:00',
  payment: payment(overrides),
})

describe('webhook do Asaas', () => {
  it('token: só o configurado vale, em tempo constante; sem token configurado recusa tudo', () => {
    expect(isValidWebhookToken(WEBHOOK_TOKEN, WEBHOOK_TOKEN)).toBe(true)
    expect(isValidWebhookToken('errado', WEBHOOK_TOKEN)).toBe(false)
    expect(isValidWebhookToken(undefined, WEBHOOK_TOKEN)).toBe(false)
    expect(isValidWebhookToken(WEBHOOK_TOKEN, undefined)).toBe(false)
    expect(isValidWebhookToken('', '')).toBe(false)
  })

  it('confirmação de pagamento ativa e leva o vencimento a um mês depois do vencimento da cobrança', async () => {
    const { service, organizations, payments, events, deliveries } = webhookSetup()
    await service.handle(paymentEvent('PAYMENT_CONFIRMED', { dueDate: '2026-11-20' }))
    expect(organizations[0]).toMatchObject({ subscriptionStatus: 'ativa', currentPeriodEnd: new Date('2026-12-20T12:00:00.000Z') })
    expect(payments[0]).toMatchObject({ asaasPaymentId: 'pay_000001', status: 'CONFIRMED', organizationId: ORG })
    expect(events.filter((event) => event.kind === 'pagamento_registrado')).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ provider: 'asaas', eventId: 'evt_PAYMENT_CONFIRMED_1', status: 'ok', organizationId: ORG })
  })

  it('CONFIRMED e depois RECEIVED da mesma cobrança: um evento de pagamento só', async () => {
    const { service, events } = webhookSetup()
    await service.handle(paymentEvent('PAYMENT_CONFIRMED'))
    await service.handle(paymentEvent('PAYMENT_RECEIVED', { status: 'RECEIVED' }))
    expect(events.filter((event) => event.kind === 'pagamento_registrado')).toHaveLength(1)
  })

  it('o mesmo evento duas vezes processa uma só', async () => {
    const { service, events, prisma } = webhookSetup()
    const first = await service.handle(paymentEvent('PAYMENT_CONFIRMED'))
    const second = await service.handle(paymentEvent('PAYMENT_CONFIRMED'))
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(events).toHaveLength(1)
    expect((prisma as unknown as { payment: { upsert: jest.Mock } }).payment.upsert).toHaveBeenCalledTimes(1)
  })

  it('entrega anterior com erro é processada de novo', async () => {
    const { service, deliveries, organizations } = webhookSetup()
    deliveries.push({ provider: 'asaas', eventId: 'evt_PAYMENT_CONFIRMED_1', event: 'PAYMENT_CONFIRMED', status: 'erro' })
    const result = await service.handle(paymentEvent('PAYMENT_CONFIRMED'))
    expect(result.duplicate).toBe(false)
    expect(organizations[0].subscriptionStatus).toBe('ativa')
    expect(deliveries[0].status).toBe('ok')
  })

  it('cobrança vencida coloca em atrasada', async () => {
    const { service, organizations } = webhookSetup(baseOrg({ subscriptionStatus: 'ativa', asaasSubscriptionId: 'sub_000001' }))
    await service.handle(paymentEvent('PAYMENT_OVERDUE', { status: 'OVERDUE', paymentDate: null }))
    expect(organizations[0].subscriptionStatus).toBe('atrasada')
  })

  it('estorno também coloca em atrasada; bloqueada continua bloqueada', async () => {
    const refunded = webhookSetup(baseOrg({ subscriptionStatus: 'ativa', asaasSubscriptionId: 'sub_000001' }))
    await refunded.service.handle(paymentEvent('PAYMENT_REFUNDED', { status: 'REFUNDED' }))
    expect(refunded.organizations[0].subscriptionStatus).toBe('atrasada')

    const blocked = webhookSetup(baseOrg({ subscriptionStatus: 'bloqueada', asaasSubscriptionId: 'sub_000001' }))
    await blocked.service.handle(paymentEvent('PAYMENT_OVERDUE', { status: 'OVERDUE' }))
    expect(blocked.organizations[0].subscriptionStatus).toBe('bloqueada')
  })

  it('organização desconhecida: responde normalmente e grava ignorado', async () => {
    const { service, deliveries, organizations } = webhookSetup(baseOrg({ asaasCustomerId: 'cus_outro', asaasSubscriptionId: 'sub_outro' }))
    const result = await service.handle(paymentEvent('PAYMENT_CONFIRMED', { customer: 'cus_x', subscription: 'sub_x' }))
    expect(result.status).toBe('ignorado')
    expect(deliveries[0]).toMatchObject({ status: 'ignorado', organizationId: null })
    expect(organizations[0].subscriptionStatus).toBe('teste')
  })

  it('evento não tratado é gravado como ignorado', async () => {
    const { service, deliveries } = webhookSetup()
    await service.handle(paymentEvent('PAYMENT_BANK_SLIP_VIEWED'))
    expect(deliveries[0]).toMatchObject({ status: 'ignorado', message: 'Evento não tratado: PAYMENT_BANK_SLIP_VIEWED' })
  })

  it('acha a organização pelo externalReference', async () => {
    const { service, organizations } = webhookSetup(baseOrg())
    await service.handle(paymentEvent('PAYMENT_CONFIRMED', { externalReference: ORG, customer: 'cus_x', subscription: 'sub_x' }))
    expect(organizations[0].subscriptionStatus).toBe('ativa')
  })

  it('assinatura atualizada mantém id e forma de cobrança', async () => {
    const { service, organizations } = webhookSetup(baseOrg({ asaasCustomerId: 'cus_000001' }))
    await service.handle({
      id: 'evt_sub_1',
      event: 'SUBSCRIPTION_UPDATED',
      subscription: { id: 'sub_000002', customer: 'cus_000001', billingType: 'PIX', value: 247, nextDueDate: '2026-12-01', cycle: 'MONTHLY', status: 'ACTIVE' },
    })
    expect(organizations[0]).toMatchObject({ asaasSubscriptionId: 'sub_000002', billingType: 'PIX' })
  })

  it('assinatura removida no Asaas registra o cancelamento, sem mudar a situação', async () => {
    const { service, organizations } = webhookSetup(baseOrg({ subscriptionStatus: 'ativa', asaasSubscriptionId: 'sub_000001' }))
    await service.handle({
      id: 'evt_sub_del',
      event: 'SUBSCRIPTION_DELETED',
      subscription: { id: 'sub_000001', customer: 'cus_000001', billingType: 'PIX', value: 247, nextDueDate: '2026-12-01', cycle: 'MONTHLY', status: 'INACTIVE', deleted: true },
    })
    expect(organizations[0].subscriptionStatus).toBe('ativa')
    expect(organizations[0].canceledAt).toBeInstanceOf(Date)
  })

  it('erro inesperado grava erro e repassa (o controller responde 500)', async () => {
    const { service, deliveries, prisma } = webhookSetup()
    ;(prisma as unknown as { payment: { upsert: jest.Mock } }).payment.upsert.mockRejectedValueOnce(new Error('banco fora'))
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    await expect(service.handle(paymentEvent('PAYMENT_CONFIRMED'))).rejects.toThrow('banco fora')
    expect(deliveries[0]).toMatchObject({ status: 'erro', message: 'banco fora' })
  })

  it('payload gravado não guarda dados de cartão nem tokens', async () => {
    const { service, deliveries, payments } = webhookSetup()
    const body = paymentEvent('PAYMENT_CONFIRMED') as AsaasWebhookEvent & { payment: Record<string, unknown> }
    body.payment.creditCard = { creditCardNumber: '8829', creditCardBrand: 'VISA', creditCardToken: 'tok_secreto' }
    await service.handle(body)
    const stored = JSON.stringify([deliveries[0].payload, payments[0].raw])
    expect(stored).not.toContain('8829')
    expect(stored).not.toContain('tok_secreto')
    expect(stored).not.toContain('creditCard')
  })
})

// ---------------------------------------------------------------- cliente HTTP

describe('AsaasClient', () => {
  it('chave no cabeçalho access_token; sandbox por padrão e produção com ASAAS_ENV=production', async () => {
    const { client, calls } = fakeAsaas()
    await client.getSubscription('sub_1')
    expect(calls[0].url).toBe('https://api-sandbox.asaas.com/v3/subscriptions/sub_1')
    expect(calls[0].headers.access_token).toBe(API_KEY)
    expect(new AsaasClient(config({ ASAAS_ENV: 'production' })).baseUrl()).toBe('https://api.asaas.com/v3')
  })

  it('5xx: tenta mais 2 vezes; 4xx: nunca repete', async () => {
    let attempts = 0
    const flaky = fakeAsaas({
      'GET /subscriptions/:id': () => {
        attempts++
        return attempts < 3 ? { status: 503, body: {} } : { status: 200, body: { id: 'sub_1' } }
      },
    })
    await expect(flaky.client.getSubscription('sub_1')).resolves.toMatchObject({ id: 'sub_1' })
    expect(attempts).toBe(3)

    const refused = fakeAsaas({ 'GET /subscriptions/:id': () => ({ status: 404, body: { errors: [{ description: 'Não encontrada' }] } }) })
    await expect(refused.client.getSubscription('sub_1')).rejects.toThrow('Asaas: Não encontrada')
    expect(refused.calls).toHaveLength(1)
  })

  it('nenhum log nem erro contém a chave da API', async () => {
    const logged: string[] = []
    const capture = (message: unknown) => {
      logged.push(String(message))
    }
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture)
    const down = fakeAsaas({ 'GET /subscriptions/:id': () => ({ status: 500, body: { detail: 'erro' } }) })
    const unauthorized = fakeAsaas({ 'GET /subscriptions/:id': () => ({ status: 401, body: {} }) })
    const errors: string[] = await Promise.all([
      down.client.getSubscription('sub_1').then(() => '', (error: Error) => error.message),
      unauthorized.client.getSubscription('sub_1').then(() => '', (error: Error) => error.message),
    ])
    expect(logged.length).toBeGreaterThan(0)
    expect([...logged, ...errors].join(' ')).not.toContain(API_KEY)
    jest.restoreAllMocks()
  })

  it('sem ASAAS_API_KEY: indisponível, sem chamar a rede', async () => {
    const client = new AsaasClient(config({}))
    client.fetcher = jest.fn()
    await expect(client.getSubscription('sub_1')).rejects.toThrow('ASAAS_API_KEY não configurada')
    expect(client.fetcher).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- webhook pelo HTTP

describe('POST /public/webhooks/asaas', () => {
  let app: NestExpressApplication
  const original = process.env.ASAAS_WEBHOOK_TOKEN

  beforeAll(async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = WEBHOOK_TOKEN
    const created = await createTestApp({
      webhookDelivery: { findUnique: jest.fn(() => Promise.resolve(null)), create: jest.fn(), update: jest.fn() },
    })
    app = created.app
  })
  afterAll(async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = original
    await app.close()
  })

  it('token errado dá 401 sem detalhes', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/public/webhooks/asaas')
      .set('asaas-access-token', 'errado')
      .send(paymentEvent('PAYMENT_CONFIRMED'))
    expect(response.status).toBe(401)
    expect(JSON.stringify(response.body)).not.toMatch(/token|asaas/i)
  })

  it('sem token dá 401', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/public/webhooks/asaas').send(paymentEvent('PAYMENT_CONFIRMED'))
    expect(response.status).toBe(401)
  })
})
