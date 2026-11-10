import type { NestExpressApplication } from '@nestjs/platform-express'
import { createValidationPipe } from './common/pipes/validation.pipe'

export const JSON_BODY_LIMIT = '100kb'

/**
 * Configuração HTTP da API, usada pelo main.ts e pelos testes de integração (o teste sobe o app igual à produção).
 *
 * Corpo JSON: parser global pelo useBodyParser, com o limite explícito (vale também para o webhook do Google).
 * NUNCA registrar app.use(caminho, json()) num caminho só: o Nest procura uma camada chamada "jsonParser" e,
 * achando, deixa de registrar o parser global. Aí todas as outras rotas recebem req.body vazio
 * (incidente de 10/11/2026: 400 "campo obrigatório" com corpo correto e TypeError no PATCH /tasks/:id)
 */
export function configureApp(app: NestExpressApplication) {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  app.useGlobalPipes(createValidationPipe())

  const allowedOrigins = ['http://localhost:3000', process.env.FRONTEND_URL].filter(Boolean) as string[]
  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: mobile, Postman, webhooks)
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin)) callback(null, true)
      else callback(new Error(`CORS bloqueado para origem: ${origin}`))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  app.setGlobalPrefix('api/v1')
  return app
}
