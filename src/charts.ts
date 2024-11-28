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
): Promise<Chart> {
  const pointsByStatus = getPointsByStatus(issues)

  const pieChartEntries = Object.values(options.statuses).reduce(
    (acc: Array<{ name: string; color: string; points: number }>, { name, color }) => {
      const points = pointsByStatus.get(name)
      if (!points) return acc
      acc.push({ name, color, points })
      return acc
    },
    [],
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const theme = { ...PIE_CHART_THEME } as any
  // mermaid forces ordering of segments so have to sort here
  for (const [idx, entry] of pieChartEntries.sort((a, b) => b.points - a.points).entries()) {
    theme[`pie${idx + 1}`] = entry.color
  }
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `pie showData title Story points by status\n` +
    pieChartEntries.map((entry) => `  "${entry.name}": ${entry.points}\n`).join('')

  const fileNamePrefix = 'storypoints-by-status-pie'
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

const rangeTo = (limit: number) => Array.from(new Array(limit), (_, i) => i)

const ucFirst = (str: string) => str[0].toLocaleUpperCase() + str.slice(1)

export async function makeRemainingStoryPointsLineChart(
  issues: JiraIssue[],
  options: Options,
  timePeriod: number,
  label: 'week' | 'day',
  cutOffFactor?: number,
): Promise<Chart> {
  const events = new Map<number, { started: number; developed: number; done: number }>()
  let totalStoryPoints = 0
  for (const issue of issues) {
    const { storyPoints, resolutionTime, devCompleteTime, startedTime } = issue

    totalStoryPoints += storyPoints
    if (resolutionTime) {
      const time = resolutionTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.done += storyPoints
      } else {
        events.set(time, { done: storyPoints, started: 0, developed: 0 })
      }
    }

    if (devCompleteTime) {
      const time = devCompleteTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.developed += storyPoints
      } else {
        events.set(time, { developed: storyPoints, done: 0, started: 0 })
      }
    }

    if (startedTime) {
      const time = startedTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.started += storyPoints
      } else {
        events.set(time, { started: storyPoints, developed: 0, done: 0 })
      }
    }
  }

  const sortedEvents = [...events.entries()]
    .map(([time, pointFields]) => ({ time, ...pointFields }))
    .sort((a, b) => a.time - b.time)

  const pointEvents: { started: number[]; developed: number[]; done: number[] } = {
    started: [],
    developed: [],
    done: [],
  }

  const fillInPoints = (points: number[], maxIndex: number) => {
    if (points.length === 0) points.push(totalStoryPoints)
    for (let i = points.length; i <= maxIndex; ++i) {
      points[i] = points[i - 1]
    }
  }
  const firstTime = sortedEvents[0].time

  for (const { time, started, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTime)
    fillInPoints(pointEvents.started, relativeTime)
    fillInPoints(pointEvents.developed, relativeTime)
    fillInPoints(pointEvents.done, relativeTime)

    pointEvents.started[relativeTime] -= started
    pointEvents.developed[relativeTime] -= developed
    pointEvents.done[relativeTime] -= done
  }

  let minY = 0
  let maxY = totalStoryPoints
  if (cutOffFactor) {
    const cutOffPoint = -cutOffFactor - 1
    pointEvents.started = pointEvents.started.slice(cutOffPoint)
    pointEvents.developed = pointEvents.developed.slice(cutOffPoint)
    pointEvents.done = pointEvents.done.slice(cutOffPoint)
    minY = pointEvents.started.at(-1)!
    maxY = pointEvents.done[0]
  }

  const { statuses } = options
  const lineChartTheme = {
    xyChart: {
      plotColorPalette: `${statuses.inProgress.color},${statuses.readyForQA.color},${statuses.done.color}`,
    },
  }

  const ucFirstLabel = ucFirst(label)
  const xAxis = rangeTo((cutOffFactor ?? Math.ceil(sortedEvents.at(-1)!.time - firstTime)) + 1)
    .map((i) => `"${ucFirstLabel} ${i}"`)
    .join(', ')
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(lineChartTheme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Story points remaining by ${label}"\n` +
    `  x-axis [${xAxis}]\n` +
    `  y-axis "Story points" ${minY} --> ${maxY}\n` +
    `  line [${pointEvents.started.join(', ')}]\n` +
    `  line [${pointEvents.developed.join(', ')}]\n` +
    `  line [${pointEvents.done.join(', ')}]\n`

  const fileNamePrefix = `remaining-storypoints-by-${label}`
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
