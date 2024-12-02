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

export async function makeStoryPointsPiChart(
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
  issues: JiraIssue[],
  options: Options,
  timePeriod: number,
  label: 'week' | 'day',
  cutOffFactor?: number,
): Promise<Chart | undefined> {
  const events = new Map<
    number,
    { started: number; toReview: number; developed: number; done: number }
  >()
  let totalStoryPoints = 0
  for (const issue of issues) {
    const { storyPoints, resolutionTime, devCompleteTime, readyForReviewTime, startedTime } = issue

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

  const pointEvents: {
    started?: number[]
    developed?: number[]
    toReview?: number[]
    done?: number[]
  } = {}

  const firstTime = sortedEvents[0].time
  // when a cut off factor is used then the chart should end at the current time and
  // buckets must all be aligned with the current time rather than the absolute first time
  const lastTime = cutOffFactor ? Date.now() / timePeriod : sortedEvents.at(-1)!.time
  const firstTimeRefPoint = cutOffFactor
    ? firstTime - (1 - ((lastTime - firstTime) % 1))
    : firstTime

  for (const { time, started, toReview, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTimeRefPoint)
    if (started) {
      if (!pointEvents.started) pointEvents.started = []
      pointEvents.started[relativeTime] = (pointEvents.started[relativeTime] ?? 0) + started
    }
    if (toReview) {
      if (!pointEvents.toReview) pointEvents.toReview = []
      pointEvents.toReview[relativeTime] = (pointEvents.toReview[relativeTime] ?? 0) + toReview
    }
    if (developed) {
      if (!pointEvents.developed) pointEvents.developed = []
      pointEvents.developed[relativeTime] = (pointEvents.developed[relativeTime] ?? 0) + developed
    }
    if (done) {
      if (!pointEvents.done) pointEvents.done = []
      pointEvents.done[relativeTime] = (pointEvents.done[relativeTime] ?? 0) + done
    }
  }

  let maxBucketIndex = Math.ceil(lastTime - firstTime)
  if (pointEvents.started) pointEvents.started.length = maxBucketIndex + 1
  if (pointEvents.toReview) pointEvents.toReview.length = maxBucketIndex + 1
  if (pointEvents.developed) pointEvents.developed.length = maxBucketIndex + 1
  if (pointEvents.done) pointEvents.done.length = maxBucketIndex + 1

  const chartPoints = {
    started: [totalStoryPoints],
    toReview: [totalStoryPoints],
    developed: [totalStoryPoints],
    done: [totalStoryPoints],
  }
  for (let i = 0; i <= maxBucketIndex; ++i) {
    const points = {
      started: pointEvents.started?.[i] ?? 0,
      toReview: pointEvents.toReview?.[i] ?? 0,
      developed: pointEvents.developed?.[i] ?? 0,
      done: pointEvents.done?.[i] ?? 0,
    }

    const prevDone = chartPoints.done[i - 1] ?? totalStoryPoints
    chartPoints.done[i] = prevDone - points.done

    const prevDeveloped = chartPoints.developed[i - 1] ?? totalStoryPoints
    chartPoints.developed[i] = Math.min(chartPoints.done[i], prevDeveloped - points.developed)

    const prevToReview = chartPoints.toReview[i - 1] ?? totalStoryPoints
    chartPoints.toReview[i] = Math.min(chartPoints.developed[i], prevToReview - points.toReview)

    const prevStarted = chartPoints.started[i - 1] ?? totalStoryPoints
    chartPoints.started[i] = Math.min(chartPoints.toReview[i], prevStarted - points.started)
  }

  let minY = 0
  let maxY = totalStoryPoints
  if (cutOffFactor) {
    maxBucketIndex = cutOffFactor
    const cutOffPoint = -cutOffFactor - 1
    chartPoints.started = chartPoints.started?.slice(cutOffPoint)
    chartPoints.toReview = chartPoints.toReview?.slice(cutOffPoint)
    chartPoints.developed = chartPoints.developed?.slice(cutOffPoint)
    chartPoints.done = chartPoints.done?.slice(cutOffPoint)

    minY = Math.min(
      chartPoints.started?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      chartPoints.toReview?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      chartPoints.developed?.at(-1) ?? Number.MAX_SAFE_INTEGER!,
      chartPoints.done?.at(-1) ?? Number.MAX_SAFE_INTEGER!,
    )
    maxY = Math.max(
      chartPoints.started?.[0] ?? 0,
      chartPoints.toReview?.[0] ?? 0,
      chartPoints.developed?.[0] ?? 0,
      chartPoints.done?.[0] ?? 0,
    )
  }

  const { statuses } = options
  const plotColorPalette: string[] = []
  const lines: string[] = []
  if (pointEvents.started) {
    plotColorPalette.push(statuses.inProgress.color)
    lines.push(`  line [${chartPoints.started.join(', ')}]`)
  }
  if (pointEvents.toReview) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${chartPoints.toReview.join(', ')}]`)
  }
  if (pointEvents.developed) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${chartPoints.developed.join(', ')}]`)
  }
  if (pointEvents.done) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${chartPoints.done.join(', ')}]`)
  }

  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(',') } }

  const ucFirstLabel = ucFirst(label)
  const xAxis = rangeTo(maxBucketIndex + 1)
    .map((i) => `"${ucFirstLabel} ${i}"`)
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
    xyChart: { plotColorPalette: `${statuses.inReview.color}, ${statuses.readyForQA.color}` },
  }
  const inReviewBar = sorted.map((stat) => stat.daysReadyForReview)
  // for some reason mermaid shows a small bar even when the value is set to 0, setting it to
  // -1 works around this, mermaid issues an error about an invalid rect but it looks better
  const readyForQABar = sorted.map((stat) => (stat.daysReadyForQA === 0 ? -1 : stat.daysReadyForQA))
  const maxX = Math.max(sorted[0].daysReadyForReview, sorted[0].daysReadyForQA)

  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Issues in review or ready for QA"\n` +
    `  x-axis [${[...sorted.map(({ status }) => status)].join(', ')}]\n` +
    `  y-axis "Number of days in status" 0 --> ${maxX}\n` +
    `  bar [${inReviewBar.join(', ')}]\n` +
    `  bar [${readyForQABar.join(', ')}]`

  return makeChartFiles(mmd, 'open-issues', options)
}
