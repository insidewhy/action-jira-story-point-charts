export const DAY_IN_MSECS = 24 * 60 * 60_000
export const WEEK_IN_MSECS = 7 * DAY_IN_MSECS

export type Period = 'day' | 'week'

export const PERIOD_LENGTHS: Record<Period, number> = {
  day: DAY_IN_MSECS,
  week: WEEK_IN_MSECS,
}

export const formatDate = (date: Date): string => {
  return (
    date.getFullYear().toString() +
    '-' +
    (date.getMonth() + 1).toString().padStart(2, '0') +
    '-' +
    date.getDate().toString().padStart(2, '0')
  )
}
