import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp, TEST_ORG, TEST_USER_ID, testAuthUser } from '../../common/testing/test-app'

// Assinatura bloqueada no app completo: guard global, rotas sempre liberadas, painel /admin e cadastro público

const TASK_ID = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('assinatura bloqueada pelo HTTP', () => {
  let app: NestExpressApplication
  let token: string
  const originalAdmins = process.env.SUPER_ADMIN_EMAILS
  const originalSignup = process.env.PUBLIC_SIGNUP_ENABLED
  const organization = {
    id: TEST_ORG, plan: 'equipe', seats: 5, subscriptionStatus: 'bloqueada', trialEndsAt: null, currentPeriodEnd: null,
    monthlyPrice: null, billingName: null, billingDocument: null, billingEmail: null, billingPhone: null,
  }
  const taskCreate = jest.fn()

  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAILS = 'dono@crm.com'
    process.env.PUBLIC_SIGNUP_ENABLED = ''
    const created = await createTestApp({
      organization: {
        findUnique: jest.fn(() => Promise.resolve(organization)),
        groupBy: jest.fn(() => Promise.resolve([])),
        aggregate: jest.fn(() => Promise.resolve({ _sum: { monthlyPrice: null } })),
      },
      user: {
        findUnique: jest.fn(() => Promise.resolve(testAuthUser)),
        count: jest.fn(() => Promise.resolve(2)),
        update: jest.fn(() => Promise.resolve(testAuthUser)),
      },
      task: {
        findMany: jest.fn(() => Promise.resolve([])),
        create: taskCreate,
        findFirst: jest.fn(() => Promise.resolve({ id: TASK_ID, organizationId: TEST_ORG, assignedTo: TEST_USER_ID })),
      },
    })
    app = created.app
    token = created.token
  })
  afterAll(async () => {
    process.env.SUPER_ADMIN_EMAILS = originalAdmins
    process.env.PUBLIC_SIGNUP_ENABLED = originalSignup
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`)

  it('GET continua funcionando (somente leitura)', async () => {
    const response = await auth(http().get('/api/v1/tasks'))
    expect(response.status).toBe(200)
  })

  it('POST e PATCH dão 402 SUBSCRIPTION_BLOCKED sem chegar ao serviço', async () => {
    const created = await auth(http().post('/api/v1/tasks')).send({ title: 'Ligar', dueDate: '2026-11-12T12:00:00.000Z' })
    expect(created.status).toBe(402)
    expect(created.body).toMatchObject({
      code: 'SUBSCRIPTION_BLOCKED',
      message: 'Assinatura bloqueada. Fale com o suporte para reativar.',
    })
    expect(taskCreate).not.toHaveBeenCalled()

    const patched = await auth(http().patch(`/api/v1/tasks/${TASK_ID}`)).send({ title: 'Outro' })
    expect(patched.status).toBe(402)
  })

  it('/auth continua liberado (perfil e troca de senha não dão 402)', async () => {
    const response = await auth(http().post('/api/v1/auth/change-password')).send({ currentPassword: 'x', newPassword: '1234567' })
    expect(response.status).toBe(400)
  })

  it('GET /billing/me responde com o aviso de bloqueio', async () => {
    const response = await auth(http().get('/api/v1/billing/me'))
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'bloqueada',
      seatsUsed: 2,
      warning: 'Assinatura bloqueada. O sistema está somente leitura.',
      warningLevel: 'bloqueio',
      isSuperAdmin: false,
      billing: null,
    })
  })

  it('PATCH /billing/me é só para diretor (corretor: 403, não 402)', async () => {
    const response = await auth(http().patch('/api/v1/billing/me')).send({ billingName: 'X' })
    expect(response.status).toBe(403)
  })

  it('/admin com e-mail fora de SUPER_ADMIN_EMAILS dá 403', async () => {
    const response = await auth(http().get('/api/v1/admin/summary'))
    expect(response.status).toBe(403)
  })

  it('cadastro público desligado dá 403', async () => {
    const response = await http().post('/api/v1/organizations/onboarding').send({
      orgName: 'Imob Nova', slug: 'imob-nova', name: 'Ana', email: 'ana@x.com', password: 'senha-forte-1',
    })
    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ message: 'Cadastro disponível apenas por contato com o suporte' })
  })
})

describe('/admin com superadministrador', () => {
  let app: NestExpressApplication
  let token: string
  const original = process.env.SUPER_ADMIN_EMAILS

  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAILS = `outro@crm.com, ${testAuthUser.email.toUpperCase()}`
    const created = await createTestApp({
      organization: {
        groupBy: jest.fn(() => Promise.resolve([{ subscriptionStatus: 'ativa', _count: { _all: 2 } }])),
        aggregate: jest.fn(() => Promise.resolve({ _sum: { monthlyPrice: 494 } })),
      },
    })
    app = created.app
    token = created.token
  })
  afterAll(async () => {
    process.env.SUPER_ADMIN_EMAILS = original
    await app.close()
  })

  it('GET /admin/summary responde', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/summary').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ total: 2, byStatus: { ativa: 2 }, monthlyRevenue: 494 })
  })

  it('POST /admin/organizations valida o corpo (CPF inválido dá 400)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', slug: 'x', plan: 'equipe', directorName: 'Y', directorEmail: 'y@x.com', billingDocument: '111.111.111-11' })
    expect(response.status).toBe(400)
  })
})
