import { JiraIssue } from './jira'

const longestHeadingLength = 'Not Yet Ready for QA'.length + 2

const percentage = (count: number, total: number, pad: number) =>
  Math.round((total / count) * 100)
    .toString()
    .padStart(pad, ' ') + '%'

function buildMetrics(
  totalStoryPoints: number,
  metrics: Array<{ label: string; start: number; end: number }>,
): string {
  const maxMetricLength = Math.max(
    ...metrics.flatMap(({ start, end }) => [
      Math.floor(Math.log10(totalStoryPoints - start)) + 1,
      Math.floor(Math.log10(totalStoryPoints - end)) + 1,
    ]),
  )

  const percentagePad = metrics[0].start === totalStoryPoints ? 3 : 2

  const diffPad =
    Math.max(...metrics.map(({ start, end }) => Math.floor(Math.log10(end - start)))) + 2
  const diffPercentagePad =
    Math.max(
      ...metrics.map(({ start, end }) =>
        Math.round((Math.log10(end - start) / totalStoryPoints) * 100),
      ),
    ) + 3

  return metrics
    .map(({ label, start, end }) => {
      const startRemaining = totalStoryPoints - start
      const endRemaining = totalStoryPoints - end

      return `> \`${(label + ':').padEnd(longestHeadingLength, ' ')} ${startRemaining.toString().padStart(maxMetricLength, ' ')} [${percentage(totalStoryPoints, startRemaining, percentagePad)}] -> ${endRemaining.toString().padStart(maxMetricLength, ' ')} [${percentage(totalStoryPoints, endRemaining, percentagePad)}] (${(
        start - end
      )
        .toString()
        .padStart(
          diffPad,
          ' ',
        )} [${percentage(totalStoryPoints, start - end, diffPercentagePad)}])\``
    })
    .join('\n')
}

export function describeChanges(
  header: string,
  issues: JiraIssue[],
  timePeriod: number,
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
      { label: 'To Do', start: start.started, end: end.started },
      { label: 'Not Yet In Review', start: start.toReview, end: end.toReview },
      { label: 'Not Yet Ready for QA', start: start.developed, end: end.developed },
      { label: 'Unfinished', start: start.done, end: end.done },
    ])
  )
}
