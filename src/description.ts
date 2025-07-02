import { JiraIssue } from './jira'
import { PointBucketVelocities } from './processing'
import { Period, PERIOD_LENGTHS } from './time'

interface TableCell {
  content: string
  prefix?: string
  suffix?: string
  padEnd?: boolean
}

const makeJiraTable = (rows: TableCell[][], footer?: string): string => {
  const nColumns = rows[0].length
  const paddings: number[] = []
  for (let i = 0; i < nColumns; ++i) {
    paddings.push(Math.max(...rows.map((row) => row[i]?.content.length ?? 0)))
  }

  const rawData = rows
    .map((cells) => {
      return cells
        .map((cell, idx) => {
          const padding = paddings[idx]!
          let line = cell.prefix ?? ''
          line += cell.padEnd
            ? cell.content.padEnd(padding, ' ')
            : cell.content.padStart(padding, ' ')
          line += cell.suffix ?? ''
          return line
        })
        .join(' ')
    })
    .join('\n')

  let data = '```\n' + rawData
  if (footer) data += `\n${footer}`
  return data + '\n```'
}

const percentage = (count: number, total: number) =>
  Math.round((total / count) * 100).toString() + '%'

/**
 * Get the mean of the velocities, excluding the last week (it may be incomplete)
 * and the first week (developer reports exclude this week to account for developer's
 * who started the project mid-week so it's best to exclude these here also)
 * @pre values.length > 2
 */
function meanOfVelocities(values: number[]): string {
  const sum = values.slice(1, -1).reduce((acc: number, next: number) => acc + next)
  return (sum / (values.length - 2)).toFixed(1)
}

const formatDiff = (value: number): string => (value > 0 ? `+${value}` : value.toString())

function buildMetrics(
  startTotal: number,
  endTotal: number,
  metrics: Array<{ label: string; start: number; end: number; velocities: number[] | undefined }>,
): string {
  const enhancedMetrics = metrics.map((metric) => {
    const diffDisplay = formatDiff(metric.start - metric.end)
    const start = endTotal - metric.start
    const end = endTotal - metric.end

    const diffPercentage = Math.round(((metric.start - metric.end) / endTotal) * 100)
    const diffPercentageDisplay = diffPercentage > 0 ? `+${diffPercentage}%` : `${diffPercentage}%`

    return {
      label: metric.label,
      velocities: metric.velocities,
      startDisplay: start.toString(),
      endDisplay: end.toString(),
      diffDisplay,
      startPercentage: percentage(endTotal, start),
      endPercentage: percentage(endTotal, end),
      diffPercentage: diffPercentageDisplay,
    }
  })

  const totalDiff = endTotal - startTotal
  const totalDiffPercentage = Math.round(((endTotal - startTotal) / endTotal) * 100)
  enhancedMetrics.push({
    label: 'Total',
    velocities: undefined,
    startDisplay: startTotal.toString(),
    endDisplay: endTotal.toString(),
    diffDisplay: formatDiff(totalDiff),
    startPercentage: percentage(endTotal, startTotal),
    endPercentage: '100%',
    diffPercentage:
      totalDiffPercentage > 0 ? `+${totalDiffPercentage}%` : `${totalDiffPercentage}%`,
  })

  return (
    '> ' +
    makeJiraTable(
      enhancedMetrics.map((metric) => {
        const cells: TableCell[] = [
          { content: `${metric.label}:`, padEnd: true },
          { content: metric.startDisplay.toString() },
          { content: metric.startPercentage, prefix: '[', suffix: '] ->' },
          { content: metric.endDisplay.toString() },
          { content: metric.endPercentage, prefix: '[', suffix: ']' },
          { content: metric.diffDisplay, prefix: '(' },
          { content: metric.diffPercentage, prefix: '[', suffix: '])' },
        ]
        if (metric.velocities?.length && metric.velocities.length > 2) {
          cells.push({ content: meanOfVelocities(metric.velocities), prefix: '- Mean Velocity: ' })
        }
        return cells
      }),
    ) +
    '\n'
  )
}

export async function describeWorkState(
  header: string,
  issues: JiraIssue[],
  comparisonIssues: JiraIssue[] | undefined,
  period: Period,
  velocities?: PointBucketVelocities,
): Promise<string | undefined> {
  const periodStart = Date.now() - PERIOD_LENGTHS[period]

  const start = { total: 0, started: 0, toReview: 0, developed: 0, done: 0 }
  const end = { total: 0, started: 0, toReview: 0, developed: 0, done: 0 }

  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
      createdTime,
    } = issue

    end.total += storyPoints
    if (createdTime < periodStart) {
      start.total += storyPoints
    }

    if (startedTime) {
      end.started += storyPoints
      if (startedTime < periodStart) {
        start.started += storyPoints
      }
    }

    if (readyForReviewTime) {
      end.toReview += storyPoints
      if (readyForReviewTime < periodStart) {
        start.toReview += storyPoints
      }
    }

    if (devCompleteTime) {
      end.developed += storyPoints
      if (devCompleteTime < periodStart) {
        start.developed += storyPoints
      }
    }

    if (resolutionTime) {
      end.done += storyPoints
      if (resolutionTime < periodStart) {
        start.done += storyPoints
      }
    }
  }

  if (comparisonIssues) {
    start.total = 0
    start.started = 0
    start.toReview = 0
    start.developed = 0
    start.done = 0

    for (const issue of comparisonIssues) {
      const {
        storyPoints,
        endTime: resolutionTime,
        devCompleteTime,
        readyForReviewTime,
        startedTime,
      } = issue

      start.total += storyPoints

      if (startedTime) {
        start.started += storyPoints
      }

      if (readyForReviewTime) {
        start.toReview += storyPoints
      }

      if (devCompleteTime) {
        start.developed += storyPoints
      }

      if (resolutionTime) {
        start.done += storyPoints
      }
    }
  }

  return (
    `> ${header}\n` +
    buildMetrics(start.total, end.total, [
      { label: 'To Do', start: start.started, end: end.started, velocities: velocities?.started },
      {
        label: 'Not Yet In Review',
        start: start.toReview,
        end: end.toReview,
        velocities: velocities?.toReview,
      },
      {
        label: 'Not Yet Ready for QA',
        start: start.developed,
        end: end.developed,
        velocities: velocities?.developed,
      },
      { label: 'Unfinished', start: start.done, end: end.done, velocities: velocities?.done },
    ]) +
    '\n'
  )
}
