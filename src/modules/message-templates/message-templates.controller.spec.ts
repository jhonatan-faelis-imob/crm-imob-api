import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { App } from 'supertest/types'
import { createValidationPipe } from '../../common/pipes/validation.pipe'
import { MessageTemplatesController } from './message-templates.controller'
import { MessageTemplatesService } from './message-templates.service'

// Integração HTTP: controller real, ValidationPipe global real (o mesmo do main.ts) e prefixo api/v1.
// Só o service é falso (sem banco)

const TEMPLATE_ID = '2fc2c444-11f2-4e9c-83a7-630fe5981d3d'
const LEAD_ID = 'cd06b65c-6710-453f-a04b-d44099662aee'
const user = { id: 'user-1', organizationId: 'org-1', role: 'corretor', teamId: null }

describe('MessageTemplatesController (HTTP + ValidationPipe global)', () => {
  let app: INestApplication<App>
  const service = {
    render: jest.fn(() => Promise.resolve({ text: 'Olá', missing: [] })),
    renderFree: jest.fn(() => Promise.resolve({ text: 'Olá', missing: [] })),
    sendLog: jest.fn(() => Promise.resolve({ ok: true })),
    sendLogFree: jest.fn(() => Promise.resolve({ ok: true })),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MessageTemplatesController],
      providers: [{ provide: MessageTemplatesService, useValue: service }],
    }).compile()
    app = moduleRef.createNestApplication()
    // Faz o papel do JwtAuthGuard: só coloca o usuário na requisição
    app.use((req: Request & { user?: typeof user }, _res: Response, next: NextFunction) => {
      req.user = user
      next()
    })
    app.useGlobalPipes(createValidationPipe())
    app.setGlobalPrefix('api/v1')
    await app.init()
  })

  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1/message-templates${path}`).send(body)

  it('render aceita o leadId de produção', async () => {
    const response = await post(`/${TEMPLATE_ID}/render`, { leadId: LEAD_ID })
    expect(response.body).not.toMatchObject({ statusCode: 400 })
    expect([200, 201]).toContain(response.status)
    expect(service.render).toHaveBeenCalledWith('org-1', TEMPLATE_ID, user, LEAD_ID)
  })

  it('render recusa leadId inválido', async () => {
    const response = await post(`/${TEMPLATE_ID}/render`, { leadId: 'nao-e-uuid' })
    expect(response.status).toBe(400)
    expect(service.render).not.toHaveBeenCalled()
  })

  it.each([
    ['render-free', '/render-free', 'renderFree'],
    ['send-log-free', '/send-log-free', 'sendLogFree'],
    ['send-log', `/${TEMPLATE_ID}/send-log`, 'sendLog'],
  ] as const)('%s aceita UUID válido e recusa inválido', async (_name, path, method) => {
    const ok = await post(path, { leadId: LEAD_ID, text: 'Olá, Maria' })
    expect([200, 201]).toContain(ok.status)
    expect(service[method]).toHaveBeenCalledTimes(1)

    const bad = await post(path, { leadId: 'nao-e-uuid', text: 'Olá, Maria' })
    expect(bad.status).toBe(400)
    expect(service[method]).toHaveBeenCalledTimes(1)
  })
})
