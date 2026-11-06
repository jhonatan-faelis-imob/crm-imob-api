import { businessDayBounds, toDateOnly, todayInBusinessTimeZone } from './date'

describe('toDateOnly', () => {
  it('ignores any time sent with the date', () => {
    expect(toDateOnly('2026-11-06T22:30:00-03:00').toISOString()).toBe('2026-11-06T00:00:00.000Z')
  })
})

describe('businessDayBounds', () => {
  it('uses Sao Paulo midnight, not UTC', () => {
    const { start, end } = businessDayBounds('2026-11-06')
    expect(start.toISOString()).toBe('2026-11-06T03:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-07T02:59:59.999Z')
  })
})

describe('todayInBusinessTimeZone', () => {
  it('keeps the Sao Paulo day at 22h, when UTC is already on the next day', () => {
    expect(todayInBusinessTimeZone(new Date('2026-11-07T01:00:00.000Z'))).toBe('2026-11-06')
  })
})
