import { JwtService } from '@nestjs/jwt'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { AppModule } from '../../app.module'
import { configureApp } from '../../app.setup'
import { PrismaService } from '../../prisma/prisma.service'

// App inteiro configurado como em produção (configureApp do main.ts), com o Prisma falso.
// Modelo/método não previsto devolve null (ou lista vazia em findMany)

export const TEST_JWT_SECRET = 'segredo-de-teste'
export const TEST_ORG = 'org-1'
export const TEST_USER_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

export type FakeModels = Record<string, Record<string, jest.Mock>>

export const testAuthUser = {
  id: TEST_USER_ID,
  email: 'c@x.com',
  name: 'Carla',
  role: 'corretor',
  organizationId: TEST_ORG,
  teamId: null,
  active: true,
  updatedAt: new Date('2026-11-01T12:00:00.000Z'),
}

function fakePrisma(models: FakeModels): PrismaService {
  const all: FakeModels = {
    ...models,
    user: { findUnique: jest.fn(() => Promise.resolve(testAuthUser)), ...models.user },
  }
  return new Proxy({} as PrismaService, {
    get(_target, model: string | symbol) {
      if (model === '$connect' || model === '$disconnect') return () => Promise.resolve()
      if (typeof model !== 'string' || model === 'then') return undefined
      return new Proxy(all[model] ?? {}, {
        get(methods, method: string) {
          return methods[method] ?? jest.fn(() => Promise.resolve(method === 'findMany' ? [] : null))
        },
      })
    },
  })
}

export async function createTestApp(models: FakeModels = {}) {
  process.env.JWT_SECRET = TEST_JWT_SECRET
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(fakePrisma(models))
    .compile()
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }))
  await app.init()
  const token = new JwtService({ secret: TEST_JWT_SECRET }).sign({
    sub: TEST_USER_ID,
    email: testAuthUser.email,
    role: testAuthUser.role,
    organizationId: TEST_ORG,
    pwd: testAuthUser.updatedAt.getTime(),
  })
  return { app, token }
}
