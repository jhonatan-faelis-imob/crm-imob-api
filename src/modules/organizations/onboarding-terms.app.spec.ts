import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { createTestApp } from '../../common/testing/test-app'
import { termsVersion } from './organizations.service'

// Cadastro público: o aceite dos termos é obrigatório (400 sem ele) e a versão vem de TERMS_VERSION

describe('onboarding: aceite dos termos', () => {
  let app: NestExpressApplication
  const original = process.env.PUBLIC_SIGNUP_ENABLED
  const body = {
    orgName: 'Imob Nova', slug: 'imob-nova', name: 'Ana', email: 'ana@x.com', phone: '(11) 98888-7777',
    document: '529.982.247-25', password: 'senha-forte-1',
  }

  beforeAll(async () => {
    process.env.PUBLIC_SIGNUP_ENABLED = 'true'
    app = (await createTestApp({})).app
  })
  afterAll(async () => {
    process.env.PUBLIC_SIGNUP_ENABLED = original
    await app.close()
  })

  const post = (payload: Record<string, unknown>) => request(app.getHttpServer()).post('/api/v1/organizations/onboarding').send(payload)

  it('sem acceptedTerms: 400', async () => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('Aceite os Termos de Uso')
  })

  it('acceptedTerms false: 400', async () => {
    expect((await post({ ...body, acceptedTerms: false })).status).toBe(400)
  })

  it('TERMS_VERSION: padrão 1.0', () => {
    expect(termsVersion(undefined)).toBe('1.0')
    expect(termsVersion('  ')).toBe('1.0')
    expect(termsVersion('2.1')).toBe('2.1')
  })
})
