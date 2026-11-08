import { cadenceDueDate, cadenceTitle } from './cadence-date'

const step = { offsetDays: 1, dueTime: '09:00', skipWeekends: false }

describe('cadenceDueDate', () => {
  it('adds the days to the Sao Paulo day and uses the step time', () => {
    // Sexta, 06/11/2026, 10h em São Paulo
    const now = new Date('2026-11-06T13:00:00.000Z')
    expect(cadenceDueDate(step, now).toISOString()).toBe('2026-11-07T12:00:00.000Z')
  })

  it('keeps the Sao Paulo day at 22h, when UTC is already on the next day', () => {
    // Sexta, 06/11/2026, 22h em São Paulo = sábado 01h UTC
    const now = new Date('2026-11-07T01:00:00.000Z')
    expect(cadenceDueDate(step, now).toISOString()).toBe('2026-11-07T12:00:00.000Z')
  })

  it('moves Saturday to Monday when skipping weekends', () => {
    // Quinta, 05/11/2026 + 2 dias = sábado
    const now = new Date('2026-11-05T13:00:00.000Z')
    const due = cadenceDueDate({ offsetDays: 2, dueTime: '09:00', skipWeekends: true }, now)
    expect(due.toISOString()).toBe('2026-11-09T12:00:00.000Z')
  })

  it('moves Sunday to Monday when skipping weekends', () => {
    // Sexta, 06/11/2026 + 2 dias = domingo
    const now = new Date('2026-11-06T13:00:00.000Z')
    const due = cadenceDueDate({ offsetDays: 2, dueTime: '14:30', skipWeekends: true }, now)
    expect(due.toISOString()).toBe('2026-11-09T17:30:00.000Z')
  })

  it('keeps the weekend when not skipping', () => {
    const now = new Date('2026-11-05T13:00:00.000Z')
    const due = cadenceDueDate({ offsetDays: 2, dueTime: '09:00', skipWeekends: false }, now)
    expect(due.toISOString()).toBe('2026-11-07T12:00:00.000Z')
  })

  it('uses now + 30 minutes when the same-day time already passed', () => {
    const now = new Date('2026-11-06T15:00:00.000Z')
    const due = cadenceDueDate({ offsetDays: 0, dueTime: '09:00', skipWeekends: false }, now)
    expect(due.toISOString()).toBe('2026-11-06T15:30:00.000Z')
  })

  it('keeps the same-day time when it is still ahead', () => {
    const now = new Date('2026-11-06T10:00:00.000Z')
    const due = cadenceDueDate({ offsetDays: 0, dueTime: '09:00', skipWeekends: false }, now)
    expect(due.toISOString()).toBe('2026-11-06T12:00:00.000Z')
  })
})

describe('cadenceTitle', () => {
  it('fills the lead name variables', () => {
    expect(cadenceTitle('Ligar para {{primeiro_nome}} ({{nome}})', '  Maria  da Silva ')).toBe(
      'Ligar para Maria (Maria  da Silva)',
    )
  })
})
