import { HttpException, HttpStatus, Injectable } from '@nestjs/common'

const MAX_ATTEMPTS = 5
const WINDOW_MS = 60 * 60 * 1000

/**
 * Limite de tentativas de troca de senha: 5 por hora por usuário. Contador em memória,
 * então vale por réplica (com 2 réplicas, até 10 por hora no total)
 */
@Injectable()
export class PasswordAttempts {
  private attempts = new Map<string, number[]>()

  /** Registra uma tentativa; acima do limite lança 429 */
  hit(userId: string, now = Date.now()): void {
    const recent = (this.attempts.get(userId) ?? []).filter((at) => now - at < WINDOW_MS)
    if (recent.length >= MAX_ATTEMPTS) {
      this.attempts.set(userId, recent)
      throw new HttpException(
        'Muitas tentativas de troca de senha. Tente de novo em uma hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    recent.push(now)
    this.attempts.set(userId, recent)
  }
}
