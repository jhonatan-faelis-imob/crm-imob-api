/** Janela deslizante em memória (vale por réplica). hit devolve false acima do limite */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    // Evita crescer sem limite com muitos IPs diferentes
    if (this.hits.size > 10_000) {
      for (const [entry, times] of this.hits) if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(entry)
    }
    return true
  }
}

/**
 * IP do cliente atrás do proxy do Railway: o último item do X-Forwarded-For é o que o proxy acrescentou
 * (os anteriores vêm do cliente e podem ser forjados)
 */
export function clientIp(request: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
  const header = request.headers['x-forwarded-for']
  const value = Array.isArray(header) ? header[header.length - 1] : header
  const last = value?.split(',').pop()?.trim()
  return last || request.ip || 'desconhecido'
}
