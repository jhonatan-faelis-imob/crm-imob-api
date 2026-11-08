import { businessDayBounds, todayInBusinessTimeZone } from '../../common/utils/date'
import { renderTemplate } from '../message-templates/render-template'

export interface CadenceTiming {
  offsetDays: number
  dueTime: string
  skipWeekends: boolean
}

// Passo de hoje cujo horário já passou não pode nascer vencido
const LATE_SAME_DAY_MINUTES = 30

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Dia da semana do calendário (0 = domingo), sem depender do fuso do servidor
function weekday(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay()
}

export function cadenceDueDate(step: CadenceTiming, now = new Date()): Date {
  let day = addDays(todayInBusinessTimeZone(now), step.offsetDays)

  if (step.skipWeekends) {
    const dayOfWeek = weekday(day)
    if (dayOfWeek === 6) day = addDays(day, 2)
    if (dayOfWeek === 0) day = addDays(day, 1)
  }

  const [hours, minutes] = step.dueTime.split(':').map(Number)
  const due = new Date(businessDayBounds(day).start.getTime() + (hours * 60 + minutes) * 60_000)

  if (step.offsetDays === 0 && due <= now) {
    return new Date(now.getTime() + LATE_SAME_DAY_MINUTES * 60_000)
  }
  return due
}

export function cadenceTitle(title: string, leadName: string): string {
  const name = leadName.trim()
  return renderTemplate(title, { nome: name, primeiro_nome: name.split(/\s+/)[0] }).text
}
