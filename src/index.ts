import { mkdir } from 'node:fs/promises'

import {
  makeOpenIssuesChart,
  makePointBuckets,
  makeRemainingStoryPointsLineChart,
  makeStoryPointsPieChart,
  makeVelocityChart,
} from './charts'
import { Options, parseOptions } from './config'
import { describeChanges } from './description'
import { fetchIssues } from './jira'
import { postChartToChannel } from './slack'

const DAY_IN_MSECS = 24 * 60 * 60_000
const WEEK_IN_MSECS = 7 * DAY_IN_MSECS

async function runChartBot(options: Options) {
  const issues = await fetchIssues(options)

  await mkdir(options.output, { recursive: true })

  const pieChart = await makeStoryPointsPieChart(issues, options)

  const weeklyPointBuckets = makePointBuckets(issues, WEEK_IN_MSECS)
  const byWeekChart = weeklyPointBuckets
    ? await makeRemainingStoryPointsLineChart(weeklyPointBuckets, options, 'week')
    : undefined

  const dailyPointBuckets = makePointBuckets(issues, DAY_IN_MSECS, 7)
  const byDayChart = dailyPointBuckets
    ? await makeRemainingStoryPointsLineChart(dailyPointBuckets, options, 'day', 7)
    : undefined

  const openIssuesChart = await makeOpenIssuesChart(issues, options)
  const weeklyVelocityChart = weeklyPointBuckets
    ? await makeVelocityChart(weeklyPointBuckets, options)
    : undefined

  const { channel } = options

  const initialCommentSections = [
    options.summary,
    options.withDailyDescription &&
      describeChanges(options.withDailyDescription, issues, DAY_IN_MSECS),
    options.withWeeklyDescription &&
      describeChanges(options.withWeeklyDescription, issues, WEEK_IN_MSECS),
  ].filter((v) => Boolean(v))

  if (channel) {
    await postChartToChannel(
      options.slackToken,
      channel,
      [byDayChart, pieChart, byWeekChart, openIssuesChart, weeklyVelocityChart].filter(
        (chart) => chart !== undefined,
      ),
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
