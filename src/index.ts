import { mkdir, writeFile } from 'node:fs/promises'

import {
  Chart,
  makeAverageWeelyVelocityByDeveloperChart,
  makeOpenIssuesChart,
  makeRemainingStoryPointsLineChart,
  makeStoryPointsPieChart,
  makeVelocityByDeveloperChart,
  makeVelocityChart,
  makeWorkItemChangesChart,
} from './charts'
import { Options, parseOptions } from './config'
import { describeWorkState } from './description'
import { fetchIssues } from './jira'
import { Pisnge } from './pisnge'
import {
  loadHistoricalData,
  loadIssueChanges,
  makePointBuckets,
  makePointBucketVelocities,
} from './processing'
import { postChartsToChannel } from './slack'
import { DAY_IN_MSECS, formatDate, WEEK_IN_MSECS } from './time'

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
  const pisnge = new Pisnge()
  pisnge.beginDownload()
  const issues = await fetchIssues(options)

  await mkdir(options.output, { recursive: true })

  const getWeeklyPointBuckets = once(() => makePointBuckets(issues, WEEK_IN_MSECS))

  const getWeeklyVelocities = once(() => {
    const weeklyBuckets = getWeeklyPointBuckets()
    return weeklyBuckets ? makePointBucketVelocities(weeklyBuckets) : undefined
  })

  const getDailyPointBuckets = once(() => makePointBuckets(issues, DAY_IN_MSECS, 7))

  const loadHistoricalDataFromPreviousDay = once(() =>
    loadHistoricalData(options.storeWorkItemHistory, 'day'),
  )
  const loadHistoricalDataFromPreviousWeek = once(() =>
    loadHistoricalData(options.storeWorkItemHistory, 'week'),
  )
  const getChangesFromPreviousDay = once(async () => {
    const comparisonIssues = await loadHistoricalDataFromPreviousDay()
    return comparisonIssues && loadIssueChanges(issues, comparisonIssues)
  })
  const getChangesFromPreviousWeek = once(async () => {
    const comparisonIssues = await loadHistoricalDataFromPreviousWeek()
    return comparisonIssues && loadIssueChanges(issues, comparisonIssues)
  })

  const allCharts = new Map<string, () => Promise<Chart | undefined>>([
    [
      'remaining-by-day',
      async () => {
        const dailyPointBuckets = getDailyPointBuckets()
        return dailyPointBuckets
          ? await makeRemainingStoryPointsLineChart(pisnge, dailyPointBuckets, options, 'day', 7)
          : undefined
      },
    ],
    ['by-status', () => makeStoryPointsPieChart(pisnge, issues, options)],
    [
      'remaining-by-week',
      async () => {
        const weeklyPointBuckets = getWeeklyPointBuckets()
        return weeklyPointBuckets
          ? makeRemainingStoryPointsLineChart(pisnge, weeklyPointBuckets, options, 'week')
          : undefined
      },
    ],
    ['in-review-and-test', () => makeOpenIssuesChart(pisnge, issues, options)],
    [
      'weekly-velocity',
      async () => {
        const weeklyVelocities = getWeeklyVelocities()
        return weeklyVelocities ? makeVelocityChart(pisnge, weeklyVelocities, options) : undefined
      },
    ],
    [
      'velocity-by-developer',
      async () => makeAverageWeelyVelocityByDeveloperChart(pisnge, issues, WEEK_IN_MSECS, options),
    ],
    [
      'velocity-by-developer-this-week',
      async () => makeVelocityByDeveloperChart(pisnge, issues, 0, 'week', 1, options),
    ],
    [
      'velocity-by-developer-last-week',
      async () => makeVelocityByDeveloperChart(pisnge, issues, 1, 'week', 1, options),
    ],
    [
      'daily-work-item-changes',
      async () =>
        makeWorkItemChangesChart(pisnge, await getChangesFromPreviousDay(), 'day', options),
    ],
    [
      'weekly-work-item-changes',
      async () =>
        makeWorkItemChangesChart(pisnge, await getChangesFromPreviousWeek(), 'week', options),
    ],
  ])

  const { channel } = options

  const charts = await Promise.all(options.charts.map((chartName) => allCharts.get(chartName)!()))

  const initialCommentSections = [
    options.summary,
    options.withDailyDescription &&
      (await describeWorkState(
        options.withDailyDescription,
        issues,
        await loadHistoricalDataFromPreviousDay(),
        'day',
      )),
    options.withWeeklyDescription &&
      (await describeWorkState(
        options.withWeeklyDescription,
        issues,
        await loadHistoricalDataFromPreviousWeek(),
        'week',
        getWeeklyVelocities(),
      )),
  ].filter((v) => Boolean(v))

  if (options.storeWorkItemHistory) {
    const jiraData = JSON.stringify(issues)
    const monthPrefix = formatDate(new Date())
    const fullPath = `${options.storeWorkItemHistory}/${monthPrefix}`
    await mkdir(fullPath, { recursive: true })
    await writeFile(`${fullPath}/jira.json`, jiraData)
  }

  if (channel) {
    const definedCharts = charts.filter((chart) => chart !== undefined)
    if (definedCharts.length) {
      await postChartsToChannel(
        options.slackToken,
        channel,
        definedCharts,
        initialCommentSections.length ? initialCommentSections.join('\n') : undefined,
      )
      console.log('Posted charts to slack')
    } else {
      console.log('No charts were produced')
    }
  } else {
    console.log('Not posting any charts as channel was not configured')
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
