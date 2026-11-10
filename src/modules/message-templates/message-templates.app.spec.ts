import { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from '../../app.module'
import { createValidationPipe } from '../../common/pipes/validation.pipe'
import { PrismaService } from '../../prisma/prisma.service'

// App inteiro (todos os módulos, guard JWT global, RolesGuard, interceptor de tenant, ValidationPipe do main.ts
// e prefixo api/v1). Só o Prisma é falso: nenhuma consulta vai ao banco

const SECRET = 'segredo-de-teste'
process.env.JWT_SECRET = SECRET

const ORG = 'org-1'
const TEMPLATE_ID = '2fc2c444-11f2-4e9c-83a7-630fe5981d3d'
const LEAD_ID = 'cd06b65c-6710-453f-a04b-d44099662aee'
const USER_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const authUser = { id: USER_ID, email: 'c@x.com', name: 'Carla', role: 'corretor', organizationId: ORG, teamId: null, active: true }
const lead = { id: LEAD_ID, name: 'Maria da Silva', ownerId: USER_ID, teamId: null, properties: [] }

// Qualquer modelo/método não previsto devolve null (ou lista vazia em findMany)
function fakePrisma(): PrismaService {
  const models: Record<string, Record<string, jest.Mock>> = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(authUser)),
      findFirst: jest.fn(() => Promise.resolve({ name: 'Carla', phone: '(19) 99999-0000', organization: { name: 'Imob' } })),
    },
    messageTemplate: {
      findFirst: jest.fn(() => Promise.resolve({ id: TEMPLATE_ID, name: 'Boas-vindas', content: 'Olá, {{primeiro_nome}}!', isPublic: true, userId: null })),
      update: jest.fn(() => Promise.resolve({})),
    },
    lead: { findFirst: jest.fn(() => Promise.resolve(lead)), update: jest.fn(() => Promise.resolve({})) },
    interaction: { create: jest.fn(() => Promise.resolve({ id: 'i-1' })) },
  }
  return new Proxy({} as PrismaService, {
    get(_target, model: string) {
      if (model === '$connect' || model === '$disconnect') return () => Promise.resolve()
      if (typeof model !== 'string' || model === 'then') return undefined
      return new Proxy(models[model] ?? {}, {
        get(methods, method: string) {
          return methods[method] ?? jest.fn(() => Promise.resolve(method === 'findMany' ? [] : null))
        },
      })
    },
  })
}

describe('message-templates no app completo', () => {
  let app: INestApplication<App>
  let token: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma())
      .compile()
    app = moduleRef.createNestApplication({ logger: false })
    app.useGlobalPipes(createValidationPipe())
    app.setGlobalPrefix('api/v1')
    await app.init()
    token = new JwtService({ secret: SECRET }).sign({ sub: USER_ID, email: authUser.email, role: 'corretor', organizationId: ORG })
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
