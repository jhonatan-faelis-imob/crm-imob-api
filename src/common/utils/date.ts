export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo'

// Colunas @db.Date guardam só o dia: fixar meia-noite UTC evita que o fuso do servidor
// ou um horário vindo do cliente desloque a data
export function toDateOnly(value: string): Date {
  const day = value.slice(0, 10)
  return new Date(`${day}T00:00:00.000Z`)
}

export function todayInBusinessTimeZone(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(now)
}

// Início e fim de um dia de negócio como instantes reais, para filtrar colunas com horário
export function businessDayBounds(day: string): { start: Date; end: Date } {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${day}T12:00:00.000Z`))
    .find((part) => part.type === 'timeZoneName')
    ?.value.replace('GMT', '')

  const start = new Date(`${day}T00:00:00.000${offset || 'Z'}`)
  return { start, end: new Date(start.getTime() + 86_399_999) }
}

export function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}
