import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }))
  app.enableCors({ origin: ['http://localhost:3000'], credentials: true })
  app.setGlobalPrefix('api/v1')
  const port = process.env.PORT ?? 3001
  await app.listen(port)
  console.log(`🚀 CRM Imob API rodando em http://localhost:${port}/api/v1`)
}
bootstrap()
