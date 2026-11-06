import { toDateOnly, todayInBusinessTimeZone } from './date'

describe('toDateOnly', () => {
  it('ignores any time sent with the date', () => {
    expect(toDateOnly('2026-11-06T22:30:00-03:00').toISOString()).toBe('2026-11-06T00:00:00.000Z')
  })
})

describe('todayInBusinessTimeZone', () => {
  it('keeps the Sao Paulo day at 22h, when UTC is already on the next day', () => {
    expect(todayInBusinessTimeZone(new Date('2026-11-07T01:00:00.000Z'))).toBe('2026-11-06')
  })
})
