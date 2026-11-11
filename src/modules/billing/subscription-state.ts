import { GRACE_DAYS } from './plans.config'

// Regras puras da situação da assinatura (sem banco): acesso, aviso, transições diárias e vencimento após pagamento

const DAY_MS = 24 * 60 * 60 * 1000

export interface SubscriptionSnapshot {
  subscriptionStatus: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}

export type WarningLevel = 'aviso' | 'bloqueio'

/** Dias inteiros até a data (arredonda para cima; negativo se já passou) */
export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS)
}

/** bloqueada e cancelada: só leitura. O resto grava normalmente */
export function isReadOnly(status: string): boolean {
  return status === 'bloqueada' || status === 'cancelada'
}

/** Data em que a assinatura venceu: fim do período ou, sem ele, fim do teste */
export function overdueSince(snapshot: SubscriptionSnapshot): Date | null {
  return snapshot.currentPeriodEnd ?? snapshot.trialEndsAt
}

/** Dias que faltam para o fim do teste (em teste) ou do período (nos outros) */
export function daysLeft(snapshot: SubscriptionSnapshot, now: Date): number | null {
  if (snapshot.subscriptionStatus === 'teste') return daysUntil(snapshot.trialEndsAt, now)
  return daysUntil(snapshot.currentPeriodEnd, now)
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Texto pronto para a faixa do topo, ou null quando está tudo certo */
export function subscriptionWarning(
  snapshot: SubscriptionSnapshot,
  now: Date,
): { warning: string; level: WarningLevel } | null {
  const status = snapshot.subscriptionStatus
  if (status === 'bloqueada') return { warning: 'Assinatura bloqueada. O sistema está somente leitura.', level: 'bloqueio' }
  if (status === 'cancelada') return { warning: 'Assinatura cancelada. O sistema está somente leitura.', level: 'bloqueio' }

  if (status === 'teste') {
    const left = daysUntil(snapshot.trialEndsAt, now)
    if (left === null) return null
    if (left <= 0) {
      return { warning: 'Seu período de teste terminou. Fale com o suporte para continuar usando.', level: 'aviso' }
    }
    return { warning: `Seu período de teste termina em ${plural(left, 'dia', 'dias')}.`, level: 'aviso' }
  }

  if (status === 'atrasada') {
    const since = overdueSince(snapshot)
    const untilBlock = since ? daysUntil(new Date(since.getTime() + GRACE_DAYS * DAY_MS), now) : null
    const tail =
      untilBlock !== null && untilBlock > 0
        ? ` Regularize para evitar o bloqueio em ${plural(untilBlock, 'dia', 'dias')}.`
        : ' Regularize para evitar o bloqueio.'
    return { warning: `Assinatura em atraso.${tail}`, level: 'aviso' }
  }

  return null
}

/**
 * Transição da tarefa diária, ou null se nada muda:
 * teste vencido → atrasada; ativa com período vencido → atrasada; atrasada há mais de GRACE_DAYS → bloqueada
 */
export function nextStatus(
  snapshot: SubscriptionSnapshot,
  now: Date,
): { status: 'atrasada' | 'bloqueada'; reason: string } | null {
  const time = now.getTime()
  switch (snapshot.subscriptionStatus) {
    case 'teste':
      if (snapshot.trialEndsAt && snapshot.trialEndsAt.getTime() < time) {
        return { status: 'atrasada', reason: 'Período de teste terminou' }
      }
      return null
    case 'ativa':
      if (snapshot.currentPeriodEnd && snapshot.currentPeriodEnd.getTime() < time) {
        return { status: 'atrasada', reason: 'Período pago venceu' }
      }
      return null
    case 'atrasada': {
      // Sem data de vencimento (marcada à mão) não bloqueia sozinha
      const since = overdueSince(snapshot)
      if (since && time - since.getTime() > GRACE_DAYS * DAY_MS) {
        return { status: 'bloqueada', reason: `Em atraso há mais de ${GRACE_DAYS} dias` }
      }
      return null
    }
    default:
      return null
  }
}

/** Soma meses mantendo o dia quando possível (31/01 + 1 mês = 28 ou 29/02) */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/** Pagamento: um mês a partir da data maior entre o vencimento atual e hoje */
export function periodEndAfterPayment(currentPeriodEnd: Date | null, now: Date): Date {
  const base = currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime() ? currentPeriodEnd : now
  return addMonths(base, 1)
}
