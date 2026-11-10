import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp, testAuthUser } from '../../common/testing/test-app'

// Validação HTTP das rotas novas (query teamId=none, senha opcional, membros, coordinatorId null)

describe('users e teams no app completo', () => {
  let app: NestExpressApplication
  let token: string
  const findMany = jest.fn((args: { where: Record<string, unknown> }) => Promise.resolve(args.where && []))
  // Como o Prisma com select: o hash não volta
  const create = jest.fn(({ data }: { data: { passwordHash: string } & Record<string, unknown> }) => {
    const { passwordHash, ...visible } = data
    return Promise.resolve({ id: 'novo', ...visible, hashed: passwordHash.length > 0 })
  })

  beforeAll(async () => {
    const created = await createTestApp({
      user: {
        findUnique: jest.fn(({ where }: { where: { id?: string } }) =>
          Promise.resolve(where.id ? { ...testAuthUser, role: 'diretor' } : null),
        ),
        findMany,
        create,
      },
    })
    app = created.app
    token = created.token
  })
  afterAll(() => app.close())

  const http = () => request(app.getHttpServer())

  it('GET /users?teamId=none filtra quem está sem equipe', async () => {
    const response = await http().get('/api/v1/users?teamId=none&role=corretor').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { teamId: null, role: 'corretor' } })
  })

  it('GET /users?teamId=qualquer-coisa dá 400', async () => {
    const response = await http().get('/api/v1/users?teamId=abc').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(400)
  })

  it('POST /users sem senha e sem equipe devolve temporaryPassword', async () => {
    const response = await http()
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nova', email: 'nova@x.com', role: 'coordenador' })
    expect(response.status).toBe(201)
    const body = response.body as { temporaryPassword?: string }
    expect(body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(body).not.toHaveProperty('passwordHash')
  })

  it('PATCH /teams/:id/members com id inválido dá 400', async () => {
    const response = await http()
      .patch('/api/v1/teams/5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ addUserIds: ['nao-e-uuid'] })
    expect(response.status).toBe(400)
  })

  it('PATCH /teams/:id valida o corpo (campo desconhecido dá 400)', async () => {
    const response = await http()
      .patch('/api/v1/teams/5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: 'outra' })
    expect(response.status).toBe(400)
  })
})
