export const DAY_IN_MSECS = 24 * 60 * 60_000
export const WEEK_IN_MSECS = 7 * DAY_IN_MSECS

export type Period = 'day' | 'week'

export const PERIOD_LENGTHS: Record<Period, number> = {
  day: DAY_IN_MSECS,
  week: WEEK_IN_MSECS,
}
