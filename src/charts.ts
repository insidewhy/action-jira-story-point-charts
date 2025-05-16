import { run as mermaidRun } from '@mermaid-js/mermaid-cli'
import { writeFile } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { Options } from './config'
import { JiraIssue } from './jira'
import { PointBuckets, PointBucketVelocities } from './processing'

export interface Chart {
  filePath: string
  mimeType: string
}

const PIE_CHART_THEME = {
  pieStrokeColor: 'white',
  pieOuterStrokeColor: 'white',
  pieSectionTextColor: 'white',
  pieOpacity: 1,
}

async function makeChartFiles(
  mmd: string,
  fileNamePrefix: string,
  options: Options,
): Promise<Chart> {
  const mmdPath = pathJoin(options.output, `${fileNamePrefix}.mmd`)
  await writeFile(mmdPath, mmd)

  if (options.noImages) {
    return { filePath: mmdPath, mimeType: 'text/vnd.mermaid' }
  } else {
    const imagePath = pathJoin(options.output, `${fileNamePrefix}.png`) as `${string}.png`

    await mermaidRun(mmdPath, imagePath)
    return { filePath: imagePath, mimeType: 'image/png' }
  }
}

function getPointsByStatus(issues: JiraIssue[]): Map<string, number> {
  const pointsByStatus = new Map<string, number>()
  for (const issue of issues) {
    const { status, storyPoints } = issue
    pointsByStatus.set(status, (pointsByStatus.get(status) ?? 0) + storyPoints)
  }

  return pointsByStatus
}

export async function makeStoryPointsPieChart(
  issues: JiraIssue[],
  options: Options,
): Promise<Chart | undefined> {
  const pointsByStatus = getPointsByStatus(issues)

  if (pointsByStatus.size === 0) return undefined

  const pieChartEntries = [...pointsByStatus.entries()].reduce(
    (acc: Array<{ name: string; color?: string; points: number }>, [name, points]) => {
      const associatedStatus = Object.values(options.statuses).find(
        ({ name: statusName }) => statusName === name.toLocaleLowerCase(),
      )
      acc.push({ name, color: associatedStatus?.color ?? undefined, points })
      return acc
    },
    [],
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const theme = { ...PIE_CHART_THEME } as any
  // mermaid forces ordering of segments so have to sort here
  for (const [idx, entry] of pieChartEntries.sort((a, b) => b.points - a.points).entries()) {
    if (entry.color) {
      theme[`pie${idx + 1}`] = entry.color
    }
  }
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `pie showData title Story points by status\n` +
    pieChartEntries.map((entry) => `  "${entry.name}": ${entry.points}\n`).join('')

  return makeChartFiles(mmd, 'storypoints-by-status-pie', options)
}

const rangeTo = (limit: number) => Array.from(new Array(limit), (_, i) => i)

const ucFirst = (str: string) => str[0].toLocaleUpperCase() + str.slice(1)

export async function makeRemainingStoryPointsLineChart(
  pointBuckets: PointBuckets,
  options: Options,
  label: 'week' | 'day',
  bucketCount?: number,
): Promise<Chart | undefined> {
  const { totalStoryPoints } = pointBuckets

  const remainingPoints = {
    started: [totalStoryPoints],
    toReview: [totalStoryPoints],
    developed: [totalStoryPoints],
    done: [totalStoryPoints],
  }

  for (let i = 0; i <= pointBuckets.maxBucketIndex; ++i) {
    remainingPoints.done[i] = totalStoryPoints - pointBuckets.done[i]
    remainingPoints.developed[i] = totalStoryPoints - pointBuckets.developed[i]
    remainingPoints.toReview[i] = totalStoryPoints - pointBuckets.toReview[i]
    remainingPoints.started[i] = totalStoryPoints - pointBuckets.started[i]
  }

  let minY = 0
  let maxY = totalStoryPoints
  if (bucketCount) {
    const cutOffPoint = -bucketCount - 1
    remainingPoints.started = remainingPoints.started?.slice(cutOffPoint)
    remainingPoints.toReview = remainingPoints.toReview?.slice(cutOffPoint)
    remainingPoints.developed = remainingPoints.developed?.slice(cutOffPoint)
    remainingPoints.done = remainingPoints.done?.slice(cutOffPoint)

    minY = Math.min(
      remainingPoints.started?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.toReview?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.developed?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.done?.at(-1) ?? Number.MAX_SAFE_INTEGER,
    )
    maxY = Math.max(
      remainingPoints.started?.[0] ?? 0,
      remainingPoints.toReview?.[0] ?? 0,
      remainingPoints.developed?.[0] ?? 0,
      remainingPoints.done?.[0] ?? 0,
    )
  }

  const { statuses } = options
  const plotColorPalette: string[] = []
  const lines: string[] = []
  if (pointBuckets.hasStartedEvents) {
    plotColorPalette.push(statuses.inProgress.color)
    lines.push(`  line [${remainingPoints.started.join(', ')}]`)
  }
  if (pointBuckets.hasToReviewEvents) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${remainingPoints.toReview.join(', ')}]`)
  }
  if (pointBuckets.hasDevelopedEvents) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${remainingPoints.developed.join(', ')}]`)
  }
  if (pointBuckets.hasDoneEvents) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${remainingPoints.done.join(', ')}]`)
  }

  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(',') } }

  const xAxisCount = (bucketCount ?? pointBuckets.maxBucketIndex) + 1
  const shownLabel = xAxisCount >= 10 ? label[0].toUpperCase() : ucFirst(label)
  const xAxis = rangeTo(xAxisCount)
    .map((i) => `"${shownLabel} ${i}"`)
    .join(', ')
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Story points remaining by ${label}"\n` +
    `  x-axis [${xAxis}]\n` +
    `  y-axis "Story points" ${minY} --> ${maxY}\n` +
    lines.join('\n')

  return makeChartFiles(mmd, `remaining-storypoints-by-${label}`, options)
}

export async function makeVelocityChart(
  velocities: PointBucketVelocities,
  options: Options,
): Promise<Chart | undefined> {
  if (velocities.started.length <= 2) return undefined

  const maxY = Math.max(
    ...velocities.done,
    ...velocities.developed,
    ...velocities.toReview,
    ...velocities.started,
  )

  const { statuses } = options
  const plotColorPalette: string[] = []
  const lines: string[] = []
  if (velocities.started.length) {
    plotColorPalette.push(statuses.inProgress.color)
    lines.push(`  line [${velocities.started.slice(1, -1).join(', ')}]`)
  }
  if (velocities.toReview.length) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${velocities.toReview.slice(1, -1).join(', ')}]`)
  }
  if (velocities.developed.length) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${velocities.developed.slice(1, -1).join(', ')}]`)
  }
  if (velocities.done.length) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${velocities.done.slice(1, -1).join(', ')}]`)
  }

  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(',') } }

  const xAxisCount = velocities.started.length - 2
  const shownLabel = xAxisCount >= 10 ? 'W' : 'Week'
  const xAxis = rangeTo(xAxisCount)
    .map((i) => `"${shownLabel} ${i + 1}"`)
    .join(', ')
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Story point velocity by week"\n` +
    `  x-axis [${xAxis}]\n` +
    `  y-axis "Story points" 0 --> ${maxY}\n` +
    lines.join('\n')

  return makeChartFiles(mmd, 'storypoint-velocity-by-week', options)
}

export async function makeOpenIssuesChart(
  issues: JiraIssue[],
  options: Options,
): Promise<Chart | undefined> {
  const openIssues = new Map<string, { daysReadyForQA: number; daysReadyForReview: number }>()
  const millisecondsInADay = 24 * 60 * 60_000
  const now = Date.now()
  const { statuses } = options

  for (const issue of issues) {
    const lcStatus = issue.status.toLocaleLowerCase()

    if (!issue.devCompleteTime) continue

    let daysReadyForQA = 0
    let daysReadyForReview = 0

    const readyForQA = lcStatus === statuses.readyForQA.name

    if (readyForQA && issue.devCompleteTime) {
      daysReadyForQA = (now - issue.devCompleteTime) / millisecondsInADay
    }

    if (issue.readyForReviewTime && (readyForQA || lcStatus === statuses.inReview.name)) {
      daysReadyForReview = (now - issue.readyForReviewTime) / millisecondsInADay
    }

    if (daysReadyForReview >= daysReadyForQA) {
      daysReadyForReview = Math.max(0, daysReadyForReview - daysReadyForQA)
    }

    if (daysReadyForQA || daysReadyForReview) {
      openIssues.set(issue.key, { daysReadyForQA, daysReadyForReview })
    }
  }

  if (openIssues.size === 0) return undefined

  const sorted = [...openIssues.entries()]
    .map(([status, stat]) => ({ status, ...stat }))
    .sort((a, b) => b.daysReadyForQA - a.daysReadyForQA)
  const theme = {
    xyChart: {
      plotColorPalette: [
        statuses.inReview.color,
        statuses.readyForQA.color,
        statuses.inReview.color,
      ].join(', '),
    },
  }
  const inReviewBar = sorted.map((stat) => stat.daysReadyForReview)
  // for some reason mermaid shows a small bar even when the value is set to 0, setting it to
  // -1 works around this, mermaid issues an error about an invalid rect but it looks better
  const readyForQABar = sorted.map((stat) => (stat.daysReadyForQA === 0 ? -1 : stat.daysReadyForQA))
  const inReviewBarOnTop = sorted.map((stat) => {
    return stat.daysReadyForQA > stat.daysReadyForReview ? stat.daysReadyForReview : -1
  })
  const maxX = Math.max(sorted[0].daysReadyForReview, sorted[0].daysReadyForQA)

  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Issues in review or ready for QA"\n` +
    `  x-axis [${[...sorted.map(({ status }) => status)].join(', ')}]\n` +
    `  y-axis "Number of days in status" 0 --> ${maxX}\n` +
    `  bar [${inReviewBar.join(', ')}]\n` +
    `  bar [${readyForQABar.join(', ')}]` +
    `  bar [${inReviewBarOnTop.join(', ')}]`

  return makeChartFiles(mmd, 'open-issues', options)
}

export async function makeAverageWeelyVelocityByDeveloperChart(
  issues: JiraIssue[],
  timePeriod: number,
  options: Options,
): Promise<Chart | undefined> {
  // map of time against map of dev complete story points by developer
  const events = new Map<number, Map<string, number>>()

  let firstDevCompleteTime = Number.MAX_SAFE_INTEGER
  for (const issue of issues) {
    const { devCompleteTime, developer, storyPoints } = issue
    if (storyPoints && developer && devCompleteTime && devCompleteTime < firstDevCompleteTime) {
      firstDevCompleteTime = devCompleteTime
    }
  }
  if (firstDevCompleteTime === Number.MAX_SAFE_INTEGER) return undefined

  const startTimes = new Map<string, number>()

  for (const issue of issues) {
    const { storyPoints, developer } = issue
    if (!storyPoints || !developer) continue

    const { devCompleteTime, startedTime } = issue
    if (startedTime) {
      const relativeTime = Math.max(
        Math.floor((startedTime - firstDevCompleteTime) / timePeriod),
        0,
      )
      const previousStartTime = startTimes.get(developer)
      if (previousStartTime === undefined || relativeTime < previousStartTime) {
        startTimes.set(developer, relativeTime)
      }
    }

    if (devCompleteTime) {
      const relativeTime = Math.floor((devCompleteTime - firstDevCompleteTime) / timePeriod)

      let timeBuckets = events.get(relativeTime)
      if (!timeBuckets) {
        timeBuckets = new Map()
        events.set(relativeTime, timeBuckets)
      }
      timeBuckets.set(developer, (timeBuckets.get(developer) ?? 0) + storyPoints)
    }
  }

  // need at least 3 weeks to calculate this data
  if (events.size < 3) return undefined

  const orderedKeys = Array.from(events.keys()).sort((a, b) => a - b)
  const keyLimit = orderedKeys.at(-1)!
  const velocities = new Map<string, number>()
  for (let i = 1; i < keyLimit; ++i) {
    for (const [developer, storyPoints] of events.get(i)?.entries() ?? []) {
      const firstDevKey = startTimes.get(developer) ?? 0
      // don't use the first bucket for a developer as it may be an incomplete week
      if (i <= firstDevKey) continue

      const nDevKeys = keyLimit - (firstDevKey + 1)
      velocities.set(developer, (velocities.get(developer) ?? 0) + storyPoints / nDevKeys)
    }
  }

  const mmd =
    `pie showData title Average weekly story point velocity\n` +
    Array.from(velocities.entries())
      .map(([developer, points]) => `  "${developer}": ${points.toFixed(1)}\n`)
      .join('')

  return makeChartFiles(mmd, 'average-weekly-storypoint-velocity-per-developer-pie', options)
}

export async function makeVelocityByDeveloperChart(
  issues: JiraIssue[],
  timePeriod: number,
  options: Options,
): Promise<Chart | undefined> {
  const velocities = new Map<string, number>()
  const weekStart = Date.now() - timePeriod

  for (const issue of issues) {
    const { storyPoints, developer } = issue
    if (!storyPoints || !developer) continue

    const { devCompleteTime } = issue

    if (devCompleteTime && devCompleteTime > weekStart) {
      velocities.set(developer, (velocities.get(developer) ?? 0) + storyPoints)
    }
  }

  const mmd =
    `pie showData title Story point velocity this week\n` +
    Array.from(velocities.entries())
      .map(([developer, points]) => `  "${developer}": ${points}\n`)
      .join('')

  return makeChartFiles(mmd, 'storypoint-velocity-per-developer-this-week-pie', options)
}
