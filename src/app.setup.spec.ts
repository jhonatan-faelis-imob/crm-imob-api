import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp, TEST_ORG, TEST_USER_ID, type FakeModels } from './common/testing/test-app'

// Impede a volta do incidente de 10/11/2026: o corpo JSON precisa chegar aos controllers em todas as rotas

const TASK_ID = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const task = { id: TASK_ID, organizationId: TEST_ORG, status: 'pendente', title: 'Ligar', assignedTo: TEST_USER_ID }

describe('configureApp: corpo das requisições', () => {
  let app: NestExpressApplication
  let token: string
  const models: FakeModels = {
    task: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'nova', ...data })),
      findFirst: jest.fn(() => Promise.resolve(task)),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...task, ...data })),
    },
  }

  beforeAll(async () => {
    const created = await createTestApp(models)
    app = created.app
    token = created.token
  })
  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  const http = () => request(app.getHttpServer())

  it('POST /auth/login com e-mail inválido lista só o erro do e-mail (o corpo chegou)', async () => {
    const response = await http().post('/api/v1/auth/login').send({ email: 'invalido', password: '123456' })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ message: ['Email inválido'] })
  })

  it('POST /tasks válido passa da validação e o service recebe o corpo', async () => {
    const response = await http()
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Ligar para a Maria', type: 'ligacao', dueDate: '2026-11-11T12:00:00.000Z', priority: 'alta' })
    expect(response.status).toBe(201)
    const [[{ data }]] = models.task.create.mock.calls as [[{ data: Record<string, unknown> }]]
    expect(data).toMatchObject({ title: 'Ligar para a Maria', type: 'ligacao', priority: 'alta' })
  })

  it('PATCH /tasks/:id recebe o corpo', async () => {
    const response = await http()
      .patch(`/api/v1/tasks/${TASK_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Ligar de novo', dueDate: '2026-11-12T12:00:00.000Z' })
    expect(response.status).toBe(200)
    const [[{ data }]] = models.task.update.mock.calls as [[{ data: { title: string; dueDate: Date } }]]
    expect(data.title).toBe('Ligar de novo')
    expect(data.dueDate).toEqual(new Date('2026-11-12T12:00:00.000Z'))
  })

  it('PATCH /tasks/:id sem nenhum campo responde 400 "Nada para atualizar" (não 500)', async () => {
    const response = await http().patch(`/api/v1/tasks/${TASK_ID}`).set('Authorization', `Bearer ${token}`).send({})
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ message: 'Nada para atualizar' })
    expect(models.task.update).not.toHaveBeenCalled()
  })

  it('PATCH /tasks/:id com campo desconhecido responde 400', async () => {
    const response = await http()
      .patch(`/api/v1/tasks/${TASK_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'concluida' })
    expect(response.status).toBe(400)
    expect(models.task.update).not.toHaveBeenCalled()
  })

  it('webhook público também lê JSON, com limite de 100 KB', async () => {
    const small = await http().post('/api/v1/public/integrations/google-ads/token-qualquer').send({ lead_id: '1' })
    expect(small.status).toBe(404)
    const big = await http()
      .post('/api/v1/public/integrations/google-ads/token-qualquer')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(120_000) }))
    expect(big.status).toBe(413)
  })

  it('GET /health devolve status, commit e startedAt', async () => {
    const response = await http().get('/api/v1/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok' })
    expect(response.body).toHaveProperty('commit')
    expect(response.body).toHaveProperty('startedAt')
  })
})
