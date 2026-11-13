import { Logger } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createValidationPipe } from './common/pipes/validation.pipe'
import { allowedOrigins, isOriginAllowed } from './common/utils/cors'

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

  // FRONTEND_URL aceita vários endereços separados por vírgula; os dois lados são normalizados antes de comparar
  const origins = allowedOrigins(process.env.FRONTEND_URL)
  const logger = new Logger('CORS')
  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: mobile, Postman, webhooks)
      if (!origin || isOriginAllowed(origin, origins)) return callback(null, true)
      // Sem erro: a resposta sai sem os cabeçalhos de CORS (o navegador bloqueia), e não vira 500
      logger.warn(`Origem recusada: ${origin}. Permitidas: ${origins.join(', ')}`)
      callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  app.setGlobalPrefix('api/v1')
  return app
}
