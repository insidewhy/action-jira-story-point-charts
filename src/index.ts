import { mkdir } from 'node:fs/promises'

import {
  Chart,
  makeAverageWeelyVelocityByDeveloperChart,
  makeOpenIssuesChart,
  makeRemainingStoryPointsLineChart,
  makeStoryPointsPieChart,
  makeVelocityByDeveloperChart,
  makeVelocityChart,
} from './charts'
import { Options, parseOptions } from './config'
import { describeChanges } from './description'
import { fetchIssues } from './jira'
import { makePointBuckets, makePointBucketVelocities } from './processing'
import { postChartToChannel } from './slack'
import { DAY_IN_MSECS, WEEK_IN_MSECS } from './time'

function once<T>(callback: () => T): () => T {
  let hasResult = false
  let result: T | undefined

  return (): T => {
    if (hasResult) return result!
    result = callback()
    hasResult = true
    return result
  }
}

async function runChartBot(options: Options) {
  const issues = await fetchIssues(options)

  await mkdir(options.output, { recursive: true })

  const getWeeklyPointBuckets = once(() => makePointBuckets(issues, WEEK_IN_MSECS))

  const getWeeklyVelocities = once(() => {
    const weeklyBuckets = getWeeklyPointBuckets()
    return weeklyBuckets ? makePointBucketVelocities(weeklyBuckets) : undefined
  })

  const getDailyPointBuckets = once(() => makePointBuckets(issues, DAY_IN_MSECS, 7))

  const allCharts = new Map<string, () => Promise<Chart | undefined>>([
    [
      'remaining-by-day',
      async () => {
        const dailyPointBuckets = getDailyPointBuckets()
        return dailyPointBuckets
          ? await makeRemainingStoryPointsLineChart(dailyPointBuckets, options, 'day', 7)
          : undefined
      },
    ],
    ['by-status', () => makeStoryPointsPieChart(issues, options)],
    [
      'remaining-by-week',
      async () => {
        const weeklyPointBuckets = getWeeklyPointBuckets()
        return weeklyPointBuckets
          ? makeRemainingStoryPointsLineChart(weeklyPointBuckets, options, 'week')
          : undefined
      },
    ],
    ['in-review-and-test', () => makeOpenIssuesChart(issues, options)],
    [
      'weekly-velocity',
      async () => {
        const weeklyVelocities = getWeeklyVelocities()
        return weeklyVelocities ? makeVelocityChart(weeklyVelocities, options) : undefined
      },
    ],
    [
      'velocity-by-developer',
      async () => makeAverageWeelyVelocityByDeveloperChart(issues, WEEK_IN_MSECS, options),
    ],
    [
      'velocity-by-developer-this-week',
      async () => makeVelocityByDeveloperChart(issues, 0, 'week', 1, options),
    ],
    [
      'velocity-by-developer-last-week',
      async () => makeVelocityByDeveloperChart(issues, 1, 'week', 1, options),
    ],
  ])

  const { channel } = options

  const charts = await Promise.all(options.charts.map((chartName) => allCharts.get(chartName)!()))

  const initialCommentSections = [
    options.summary,
    options.withDailyDescription &&
      describeChanges(options.withDailyDescription, issues, DAY_IN_MSECS),
    options.withWeeklyDescription &&
      describeChanges(options.withWeeklyDescription, issues, WEEK_IN_MSECS, getWeeklyVelocities()),
  ].filter((v) => Boolean(v))

  if (channel) {
    await postChartToChannel(
      options.slackToken,
      channel,
      charts.filter((chart) => chart !== undefined),
      initialCommentSections.length ? initialCommentSections.join('\n') : undefined,
    )
  }
}

export async function run(): Promise<void> {
  const options = parseOptions()
  await runChartBot(options)
}

if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
