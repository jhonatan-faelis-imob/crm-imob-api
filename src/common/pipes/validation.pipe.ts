import { ValidationPipe } from '@nestjs/common'

// ValidationPipe global da API. Fica aqui para os testes de integração usarem exatamente o mesmo
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
}
