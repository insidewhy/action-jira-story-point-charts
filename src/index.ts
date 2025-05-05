import { mkdir } from 'node:fs/promises'

import {
  makeOpenIssuesChart,
  makeRemainingStoryPointsLineChart,
  makeStoryPointsPieChart,
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
  const byWeekChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    WEEK_IN_MSECS,
    'week',
  )
  const byDayChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    DAY_IN_MSECS,
    'day',
    7,
  )
  const openIssuesChart = await makeOpenIssuesChart(issues, options)

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
      [byDayChart, pieChart, byWeekChart, openIssuesChart].filter((chart) => chart !== undefined),
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
