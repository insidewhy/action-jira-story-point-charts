import { run as mermaidRun } from '@mermaid-js/mermaid-cli'
import { writeFile } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { Options } from './config'
import { JiraIssue } from './jira'

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

export interface PointBuckets {
  started: number[]
  hasStartedEvents: boolean

  developed: number[]
  hasDevelopedEvents: boolean

  toReview: number[]
  hasToReviewEvents: boolean

  done: number[]
  hasDoneEvents: boolean

  totalStoryPoints: number
  maxBucketIndex: number
}

export function makePointBuckets(
  issues: JiraIssue[],
  timePeriod: number,
  bucketCount?: number,
): PointBuckets | undefined {
  const events = new Map<
    number,
    { started: number; toReview: number; developed: number; done: number }
  >()
  let totalStoryPoints = 0
  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
    } = issue

    totalStoryPoints += storyPoints
    if (resolutionTime) {
      const time = resolutionTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.done += storyPoints
      } else {
        events.set(time, { done: storyPoints, started: 0, toReview: 0, developed: 0 })
      }
    }

    if (readyForReviewTime) {
      const time = readyForReviewTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.toReview += storyPoints
      } else {
        events.set(time, { toReview: storyPoints, done: 0, developed: 0, started: 0 })
      }
    }

    if (devCompleteTime) {
      const time = devCompleteTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.developed += storyPoints
      } else {
        events.set(time, { developed: storyPoints, done: 0, toReview: 0, started: 0 })
      }
    }

    if (startedTime) {
      const time = startedTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.started += storyPoints
      } else {
        events.set(time, { started: storyPoints, developed: 0, toReview: 0, done: 0 })
      }
    }
  }

  if (events.size === 0) return undefined

  const sortedEvents = [...events.entries()]
    .map(([time, pointFields]) => ({ time, ...pointFields }))
    .sort((a, b) => a.time - b.time)

  const firstTime = sortedEvents[0].time
  // when a cut off factor is used then the chart should end at the current time and
  // buckets must all be aligned with the current time rather than the absolute first time
  const lastTime = bucketCount ? Date.now() / timePeriod : sortedEvents.at(-1)!.time
  const firstTimeRefPoint = bucketCount ? firstTime - (1 - ((lastTime - firstTime) % 1)) : firstTime

  const pointBuckets: PointBuckets = {
    started: [],
    hasStartedEvents: false,
    developed: [],
    hasDevelopedEvents: false,
    toReview: [],
    hasToReviewEvents: false,
    done: [],
    hasDoneEvents: false,
    totalStoryPoints,
    maxBucketIndex: Math.ceil(lastTime - firstTime),
  }

  for (const { time, started, toReview, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTimeRefPoint)
    if (started) {
      pointBuckets.started[relativeTime] = (pointBuckets.started[relativeTime] ?? 0) + started
    }
    if (toReview) {
      pointBuckets.toReview[relativeTime] = (pointBuckets.toReview[relativeTime] ?? 0) + toReview
    }
    if (developed) {
      pointBuckets.developed[relativeTime] = (pointBuckets.developed[relativeTime] ?? 0) + developed
    }
    if (done) {
      pointBuckets.done[relativeTime] = (pointBuckets.done[relativeTime] ?? 0) + done
    }
  }

  pointBuckets.hasStartedEvents = Boolean(pointBuckets.started.length)
  pointBuckets.hasToReviewEvents = Boolean(pointBuckets.toReview.length)
  pointBuckets.hasDevelopedEvents = Boolean(pointBuckets.developed.length)
  pointBuckets.hasDoneEvents = Boolean(pointBuckets.done.length)

  pointBuckets.started.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.toReview.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.developed.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.done.length = pointBuckets.maxBucketIndex + 1

  for (let i = 0; i <= pointBuckets.maxBucketIndex; ++i) {
    const points = {
      started: pointBuckets.started[i] ?? 0,
      toReview: pointBuckets.toReview[i] ?? 0,
      developed: pointBuckets.developed[i] ?? 0,
      done: pointBuckets.done[i] ?? 0,
    }

    const prevDone = pointBuckets.done[i - 1] ?? 0
    pointBuckets.done[i] = prevDone + points.done

    const prevDeveloped = pointBuckets.developed[i - 1] ?? 0
    pointBuckets.developed[i] = Math.max(pointBuckets.done[i], prevDeveloped + points.developed)

    const prevToReview = pointBuckets.toReview[i - 1] ?? 0
    pointBuckets.toReview[i] = Math.max(pointBuckets.developed[i], prevToReview + points.toReview)

    const prevStarted = pointBuckets.started[i - 1] ?? 0
    pointBuckets.started[i] = Math.max(pointBuckets.toReview[i], prevStarted + points.started)
  }

  return pointBuckets
}

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

export interface PointBucketVelocities {
  started: number[]
  developed: number[]
  toReview: number[]
  done: number[]
}

export function makePointBucketVelocities(pointBuckets: PointBuckets): PointBucketVelocities {
  const velocities: PointBucketVelocities = {
    started: pointBuckets.hasStartedEvents ? [pointBuckets.started[0]] : [],
    toReview: pointBuckets.hasToReviewEvents ? [pointBuckets.toReview[0]] : [],
    developed: pointBuckets.hasDevelopedEvents ? [pointBuckets.developed[0]] : [],
    done: pointBuckets.hasDoneEvents ? [pointBuckets.done[0]] : [],
  }

  for (let i = 1; i <= pointBuckets.maxBucketIndex; ++i) {
    if (velocities.done.length) velocities.done[i] = pointBuckets.done[i] - pointBuckets.done[i - 1]
    if (velocities.developed.length)
      velocities.developed[i] = pointBuckets.developed[i] - pointBuckets.developed[i - 1]
    if (velocities.toReview.length)
      velocities.toReview[i] = pointBuckets.toReview[i] - pointBuckets.toReview[i - 1]
    if (velocities.started.length)
      velocities.started[i] = pointBuckets.started[i] - pointBuckets.started[i - 1]
  }

  return velocities
}

export async function makeVelocityChart(
  velocities: PointBucketVelocities,
  options: Options,
): Promise<Chart | undefined> {
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
    lines.push(`  line [${velocities.started.join(', ')}]`)
  }
  if (velocities.toReview.length) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${velocities.toReview.join(', ')}]`)
  }
  if (velocities.developed.length) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${velocities.developed.join(', ')}]`)
  }
  if (velocities.done.length) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${velocities.done.join(', ')}]`)
  }

  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(',') } }

  const xAxisCount = Math.max(
    velocities.started.length,
    velocities.toReview.length,
    velocities.toReview.length,
    velocities.done.length,
  )
  const shownLabel = xAxisCount >= 10 ? 'W' : 'Week'
  const xAxis = rangeTo(xAxisCount)
    .map((i) => `"${shownLabel} ${i}"`)
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
