import { JiraIssue } from './jira'
import { PointBucketVelocities } from './processing'

const longestHeadingLength = 'Not Yet Ready for QA'.length + 2

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

const numberOfDigits = (value: number): number => Math.floor(Math.log10(value)) + 1

function buildMetrics(
  startTotal: number,
  endTotal: number,
  metrics: Array<{ label: string; start: number; end: number; velocities: number[] | undefined }>,
): string {
  const enhancedMetrics = metrics.map((metric) => {
    const diff = metric.start - metric.end
    const diffDisplay = diff > 0 ? `+${diff}` : diff.toString()
    const startDisplay = endTotal - metric.start
    const endDisplay = endTotal - metric.end

    const diffPercentage = Math.round(((metric.start - metric.end) / endTotal) * 100)
    const diffPercentageDisplay = diffPercentage > 0 ? `+${diffPercentage}%` : `${diffPercentage}%`

    return {
      label: metric.label,
      velocities: metric.velocities,
      startDisplay,
      endDisplay,
      diffDisplay,
      startPercentage: percentage(endTotal, startDisplay),
      endPercentage: percentage(endTotal, endDisplay),
      diffPercentage: diffPercentageDisplay,
    }
  })

  const totalDiff = endTotal - startTotal
  const totalDiffPercentage = Math.round(((endTotal - startTotal) / endTotal) * 100)
  enhancedMetrics.push({
    label: 'Total',
    velocities: undefined,
    startDisplay: startTotal,
    endDisplay: endTotal,
    diffDisplay: totalDiff > 0 ? `+${totalDiff}` : totalDiff.toString(),
    startPercentage: percentage(endTotal, startTotal),
    endPercentage: '100%',
    diffPercentage:
      totalDiffPercentage > 0 ? `+${totalDiffPercentage}%` : `${totalDiffPercentage}%`,
  })

  const maxMetricLength = Math.max(
    ...enhancedMetrics.flatMap(({ startDisplay, endDisplay }) => [
      numberOfDigits(startDisplay),
      numberOfDigits(endDisplay),
    ]),
  )

  // TODO: use 4 when displaying totals because the start will always be 100%
  const startPercentagePad = Math.max(
    ...enhancedMetrics.map(({ startPercentage }) => startPercentage.length),
  )
  const endPercentagePad = Math.max(
    ...enhancedMetrics.map(({ endPercentage }) => endPercentage.length),
  )

  const diffPad = Math.max(...enhancedMetrics.map(({ diffDisplay }) => diffDisplay.length))
  const diffPercentagePad = Math.max(
    ...enhancedMetrics.map(({ diffPercentage }) => diffPercentage.length),
  )

  return enhancedMetrics
    .map(
      ({
        label,
        startDisplay,
        endDisplay,
        startPercentage,
        endPercentage,
        diffDisplay,
        diffPercentage,
        velocities,
      }) => {
        let lineContent =
          (label + ':').padEnd(longestHeadingLength, ' ') +
          ' ' +
          startDisplay.toString().padStart(maxMetricLength, ' ') +
          ' [' +
          startPercentage.padStart(startPercentagePad) +
          '] -> ' +
          endDisplay.toString().padStart(maxMetricLength, ' ') +
          ' [' +
          endPercentage.padStart(endPercentagePad) +
          '] (' +
          diffDisplay.toString().padStart(diffPad, ' ') +
          ' [' +
          diffPercentage.padStart(diffPercentagePad) +
          '])'

        if (velocities?.length && velocities.length > 2) {
          lineContent += ` - Mean Velocity: ${meanOfVelocities(velocities)}`
        }

        return `> \`${lineContent}\``
      },
    )
    .join('\n')
}

export function describeChanges(
  header: string,
  issues: JiraIssue[],
  timePeriod: number,
  velocities?: PointBucketVelocities,
): string | undefined {
  const periodStart = Date.now() - timePeriod

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
    ])
  )
}
