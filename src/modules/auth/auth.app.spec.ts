import { JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp, TEST_JWT_SECRET, TEST_ORG, TEST_USER_ID, testAuthUser } from '../../common/testing/test-app'

// Rotas de perfil e senha no app completo (ValidationPipe global com whitelist e forbidNonWhitelisted)

describe('auth: perfil e senha pelo HTTP', () => {
  let app: NestExpressApplication
  let token: string
  const update = jest.fn(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...testAuthUser, ...data, phone: null, creci: null, avatarUrl: null, createdAt: new Date(), team: null, organization: { name: 'Imob' } }),
  )
  const findFirst = jest.fn(() => Promise.resolve(null))

  beforeAll(async () => {
    const created = await createTestApp({ user: { update, findFirst } })
    app = created.app
    token = created.token
  })
  afterAll(() => app.close())
  beforeEach(() => jest.clearAllMocks())

  const http = () => request(app.getHttpServer())
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`)

  it.each([
    ['role', { role: 'diretor' }],
    ['email', { email: 'outro@x.com' }],
    ['teamId', { teamId: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }],
    ['active', { active: false }],
    ['organizationId', { organizationId: 'outra' }],
  ])('PATCH /auth/profile com %s dá 400 e não grava nada', async (_field, body) => {
    const response = await auth(http().patch('/api/v1/auth/profile')).send({ name: 'Carla', ...body })
    expect(response.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('PATCH /auth/profile com nome devolve o perfil e tokens novos', async () => {
    const response = await auth(http().patch('/api/v1/auth/profile')).send({ name: 'Carla Souza' })
    expect(response.status).toBe(200)
    const body = response.body as { user: { name: string }; accessToken: string; refreshToken: string }
    expect(body.user.name).toBe('Carla Souza')
    expect(body.accessToken).toEqual(expect.any(String))
    expect(body.refreshToken).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain('passwordHash')
  })

  it('POST /auth/change-password com nova senha curta dá 400', async () => {
    const response = await auth(http().post('/api/v1/auth/change-password')).send({ currentPassword: 'x', newPassword: '1234567' })
    expect(response.status).toBe(400)
  })

  it('token sem pwd (de antes da regra) dá 401', async () => {
    const legacy = new JwtService({ secret: TEST_JWT_SECRET }).sign({ sub: TEST_USER_ID, email: 'c@x.com', role: 'corretor', organizationId: TEST_ORG })
    const response = await http().get('/api/v1/auth/profile').set('Authorization', `Bearer ${legacy}`)
    expect(response.status).toBe(401)
  })

  it('login normaliza o e-mail antes de validar e buscar', async () => {
    const response = await http().post('/api/v1/auth/login').send({ email: ' Joao@Teste.com ', password: 'qualquer-coisa' })
    expect(response.status).toBe(401)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { email: { equals: 'joao@teste.com', mode: 'insensitive' } } }))
  })
})
