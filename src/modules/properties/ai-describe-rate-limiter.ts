import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { AI_DESCRIBE_LIMIT_PER_HOUR } from './portal.config'

const WINDOW_MS = 60 * 60 * 1000

// Contador em memória por usuário (janela deslizante de 1 hora). Só vale com 1 réplica da API:
// com mais réplicas, cada uma conta separado. Reiniciar a API zera os contadores.
@Injectable()
export class AiDescribeRateLimiter {
  private readonly calls = new Map<string, number[]>()

  consume(userId: string, now = Date.now()) {
    const recent = (this.calls.get(userId) ?? []).filter((time) => now - time < WINDOW_MS)
    if (recent.length >= AI_DESCRIBE_LIMIT_PER_HOUR) {
      this.calls.set(userId, recent)
      throw new HttpException(
        `Limite de ${AI_DESCRIBE_LIMIT_PER_HOUR} gerações por hora atingido. Tente de novo mais tarde.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    recent.push(now)
    this.calls.set(userId, recent)
  }
}
