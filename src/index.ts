import { mkdir } from 'node:fs/promises'

import { makeRemainingStoryPointsLineChart, makeStoryPointsPiChart } from './charts'
import { Options, parseOptions } from './config'
import { fetchIssues } from './jira'
import { postChartToChannel } from './slack'

async function runChartBot(options: Options) {
  const issues = await fetchIssues(options)

  await mkdir(options.output, { recursive: true })

  const pieChart = await makeStoryPointsPiChart(issues, options)
  const byWeekChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    7 * 24 * 60 * 60_000,
    'week',
  )
  const byDayChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    24 * 60 * 60_000,
    'day',
    7,
  )

  const { channel } = options
  if (channel) {
    await postChartToChannel(options.slackToken, channel, [byDayChart, pieChart, byWeekChart])
  }
}

export async function run(): Promise<void> {
  const options = await parseOptions()
  await runChartBot(options)
}

if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
