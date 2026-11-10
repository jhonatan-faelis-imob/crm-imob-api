import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Prisma } from '@prisma/client'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'

;(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON =
  function (this: Prisma.Decimal) { return this.toNumber() }

// Produção roda o JS compilado (node dist/main.js), nunca nest start
async function bootstrap() {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule))
  const port = process.env.PORT ?? 3001
  await app.listen(port)
  console.log(`🚀 CRM Imob API rodando em http://localhost:${port}/api/v1`)
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
  console.log(`📦 Memória em repouso (RSS): ${rssMb} MB`)
}
bootstrap()
