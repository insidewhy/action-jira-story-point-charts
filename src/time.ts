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

const isSameDateMonthAndYear = (d1: Date, d2: Date): boolean =>
  d1.getDate() === d2.getDate() &&
  d1.getMonth() === d2.getMonth() &&
  d1.getFullYear() === d2.getFullYear()

export const workDaysBetween = (fromDate: Date, toDate: Date, workDays: Set<number>): number => {
  if (isSameDateMonthAndYear(toDate, fromDate)) {
    return workDays.has(toDate.getDay()) ? toDate.getTime() - fromDate.getTime() / DAY_IN_MSECS : 0
  }

  let daysBetween = 0

  // if the start date is a work day, then add the portion remaining of that day to the days between
  if (workDays.has(fromDate.getDay())) {
    const midnight = new Date(fromDate)
    midnight.setHours(0, 0, 0, 0)
    daysBetween += (DAY_IN_MSECS - (fromDate.getTime() - midnight.getTime())) / DAY_IN_MSECS
  }

  // add one for every day after fromDate and before toDate that is a work day
  const nextDate = new Date(fromDate)
  nextDate.setHours(24, 0, 0, 0)
  while (!isSameDateMonthAndYear(nextDate, toDate)) {
    if (workDays.has(nextDate.getDay())) {
      ++daysBetween
    }
    nextDate.setDate(nextDate.getDate() + 1)
  }

  // if the end date is a work day then add the portion of the day passed in that date
  if (workDays.has(toDate.getDay())) {
    daysBetween += (toDate.getTime() - nextDate.getTime()) / DAY_IN_MSECS
  }

  return daysBetween
}

export const getNextWorkDay = (date: Date, workDays: Set<number>): Date => {
  const nextDate = new Date(date)
  do {
    nextDate.setDate(nextDate.getDate() + 1)
  } while (!workDays.has(nextDate.getDay()))
  return nextDate
}
