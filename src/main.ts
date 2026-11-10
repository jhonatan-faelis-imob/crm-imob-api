import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AppModule } from './app.module'
import { json } from 'express'

;(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON =
  function (this: Prisma.Decimal) { return this.toNumber() }

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  // Webhooks públicos das integrações: corpo limitado a 100 KB. Registrado antes do parser do Nest,
  // que encontra o corpo já lido e não processa de novo
  app.use('/api/v1/public/integrations', json({ limit: '100kb' }))
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }))
  const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[]

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (ex: mobile, Postman)
      if (!origin) return callback(null, true)

      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS bloqueado para origem: ${origin}`))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
  app.setGlobalPrefix('api/v1')
  const port = process.env.PORT ?? 3001
  await app.listen(port)
  console.log(`🚀 CRM Imob API rodando em http://localhost:${port}/api/v1`)
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
  console.log(`📦 Memória em repouso (RSS): ${rssMb} MB`)
}
bootstrap()
