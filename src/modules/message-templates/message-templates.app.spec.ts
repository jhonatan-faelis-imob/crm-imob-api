import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp, TEST_ORG, TEST_USER_ID } from '../../common/testing/test-app'

// App inteiro configurado como em produção (configureApp, o mesmo do main.ts). Só o Prisma é falso.
// Antes ele montava o app à mão, sem o parser do main.ts, e por isso não pegou o incidente do corpo vazio

const TEMPLATE_ID = '2fc2c444-11f2-4e9c-83a7-630fe5981d3d'
const LEAD_ID = 'cd06b65c-6710-453f-a04b-d44099662aee'
const lead = { id: LEAD_ID, name: 'Maria da Silva', ownerId: TEST_USER_ID, teamId: null, properties: [] }

describe('message-templates no app completo', () => {
  let app: NestExpressApplication
  let token: string

  beforeAll(async () => {
    const created = await createTestApp({
      user: {
        findFirst: jest.fn(() => Promise.resolve({ name: 'Carla', phone: '(19) 99999-0000', organization: { name: 'Imob' } })),
      },
      messageTemplate: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: TEMPLATE_ID, organizationId: TEST_ORG, name: 'Boas-vindas', content: 'Olá, {{primeiro_nome}}!', isPublic: true, userId: null }),
        ),
        update: jest.fn(() => Promise.resolve({})),
      },
      lead: { findFirst: jest.fn(() => Promise.resolve(lead)), update: jest.fn(() => Promise.resolve({})) },
      interaction: { create: jest.fn(() => Promise.resolve({ id: 'i-1' })) },
    })
    app = created.app
    token = created.token
  })

  afterAll(() => app.close())

  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/message-templates${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  it('POST /:id/render com o corpo de produção', async () => {
    const response = await post(`/${TEMPLATE_ID}/render`, { leadId: LEAD_ID })
    expect(response.body).not.toMatchObject({ message: ['leadId must be a UUID'] })
    expect([200, 201]).toContain(response.status)
    expect(response.body).toMatchObject({ text: 'Olá, Maria!' })
  })

  it('POST /:id/render com leadId inválido: 400', async () => {
    expect((await post(`/${TEMPLATE_ID}/render`, { leadId: 'x' })).status).toBe(400)
  })

  it.each([
    ['/render-free'],
    ['/send-log-free'],
    [`/${TEMPLATE_ID}/send-log`],
  ])('POST %s: UUID válido passa, inválido dá 400', async (path) => {
    expect([200, 201]).toContain((await post(path, { leadId: LEAD_ID, text: 'Olá, Maria' })).status)
    expect((await post(path, { leadId: 'x', text: 'Olá, Maria' })).status).toBe(400)
  })
})
