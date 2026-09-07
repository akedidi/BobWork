import { describe, expect, it } from 'vitest'
import { formatScheduleFrequency, showRunAtField } from './scheduleDisplay'

describe('scheduleDisplay', () => {
  it('formats recurring schedules with run time', () => {
    expect(formatScheduleFrequency('every day', '09:00')).toBe('Chaque jour à 09:00')
    expect(formatScheduleFrequency('every week', '18:30')).toBe('Chaque semaine à 18:30')
  })

  it('hides run time for one-shot test schedules', () => {
    expect(formatScheduleFrequency('in 5 minutes', '09:00')).toBe('Dans 5 minutes (test)')
    expect(showRunAtField('in 5 minutes')).toBe(false)
    expect(showRunAtField('every day')).toBe(true)
  })
})
