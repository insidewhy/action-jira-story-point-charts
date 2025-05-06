import { JiraIssue } from './jira'
import { PointBucketVelocities } from './processing'

const longestHeadingLength = 'Not Yet Ready for QA'.length + 2

const percentage = (count: number, total: number, pad: number) =>
  Math.round((total / count) * 100)
    .toString()
    .padStart(pad, ' ') + '%'

/**
 * Get the mean of the velocities, excluding week 0 (at most it will only record the first issue
 * starting) and last week (it may be incomplete)
 * @pre values.length > 2
 */
function meanOfVelocities(values: number[]): number {
  const sum = values.slice(1, -1).reduce((acc: number, next: number) => acc + next)
  return Math.round(sum / values.length)
}

const numberOfDigits = (value: number): number => Math.floor(Math.log10(value)) + 1

function buildMetrics(
  totalStoryPoints: number,
  metrics: Array<{ label: string; start: number; end: number; velocities: number[] | undefined }>,
): string {
  const maxMetricLength = Math.max(
    ...metrics.flatMap(({ start, end }) => [
      numberOfDigits(totalStoryPoints - start),
      numberOfDigits(totalStoryPoints - end),
    ]),
  )

  const percentagePad = metrics[0].start === totalStoryPoints ? 3 : 2

  const diffPad = Math.max(...metrics.map(({ start, end }) => numberOfDigits(end - start))) + 1
  const diffPercentagePad =
    Math.max(
      ...metrics.map(({ start, end }) => numberOfDigits(((end - start) / totalStoryPoints) * 100)),
    ) + 1

  return metrics
    .map(({ label, start, end, velocities }) => {
      const startRemaining = totalStoryPoints - start
      const endRemaining = totalStoryPoints - end

      let lineContent =
        (label + ':').padEnd(longestHeadingLength, ' ') +
        ' ' +
        startRemaining.toString().padStart(maxMetricLength, ' ') +
        ' [' +
        percentage(totalStoryPoints, startRemaining, percentagePad) +
        '] -> ' +
        endRemaining.toString().padStart(maxMetricLength, ' ') +
        '[' +
        percentage(totalStoryPoints, endRemaining, percentagePad) +
        '] (' +
        (start - end).toString().padStart(diffPad, ' ') +
        ' [' +
        percentage(totalStoryPoints, start - end, diffPercentagePad) +
        '])'

      if (velocities?.length && velocities.length > 2) {
        lineContent += ` - Mean Velocity: ${meanOfVelocities(velocities)}`
      }

      return `> \`${lineContent}\``
    })
    .join('\n')
}

export function describeChanges(
  header: string,
  issues: JiraIssue[],
  timePeriod: number,
  velocities?: PointBucketVelocities,
): string | undefined {
  const periodStart = Date.now() - timePeriod

  let totalStoryPoints = 0
  const start = { started: 0, toReview: 0, developed: 0, done: 0 }
  const end = { started: 0, toReview: 0, developed: 0, done: 0 }

  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
    } = issue

    totalStoryPoints += storyPoints

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
    buildMetrics(totalStoryPoints, [
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
