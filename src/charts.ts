import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join as pathJoin } from 'node:path'

import { Options, Status } from './config'
import { fetchIssuesFromSprint, FieldIds, getCurrentSprintIdAndConfig, JiraIssue } from './jira'
import { Pisnge } from './pisnge'
import { IssueChange, PointBuckets, PointBucketVelocities } from './processing'
import { formatDate, getNextWorkDay, Period, PERIOD_LENGTHS, workDaysBetween } from './time'

export interface Chart {
  filePath: string
  mimeType: string
}

const STORY_POINTS_BY_STATUS_PIE_CHART_THEME = {
  pieStrokeColor: 'white',
  pieOuterStrokeColor: 'white',
  pieSectionTextColor: 'white',
  pieOpacity: 1,
}

const DEFAULT_PIE_CHART_THEME = {
  pieOpacity: 0.3,
}

async function makeChartFiles(
  pisnge: Pisnge,
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
    await pisnge.run(['-i', mmdPath, '-o', imagePath])
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
  pisnge: Pisnge,
  issues: JiraIssue[],
  options: Options,
): Promise<Chart | undefined> {
  const pointsByStatus = getPointsByStatus(issues)

  if (pointsByStatus.size === 0) return undefined

  const pieChartEntries = [...pointsByStatus.entries()].reduce(
    (
      acc: Array<{ name: string; color: string; points: number; index: number }>,
      [name, points],
    ) => {
      const statusValues = Object.values(options.statuses) as Status[]
      const associatedStatusIndex = statusValues.findIndex(
        ({ name: statusName }) => statusName === name.toLocaleLowerCase(),
      )

      acc.push({
        name,
        color: statusValues[associatedStatusIndex]!.color,
        points,
        index: associatedStatusIndex,
      })
      return acc
    },
    [],
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const theme = { ...STORY_POINTS_BY_STATUS_PIE_CHART_THEME } as any
  for (const [idx, entry] of pieChartEntries.sort((a, b) => a.index - b.index).entries()) {
    if (entry.color) {
      theme[`pie${idx + 1}`] = entry.color
    }
  }
  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `pie showData title Story points by status\n` +
    pieChartEntries.map((entry) => `  "${entry.name}": ${entry.points}\n`).join('')

  return makeChartFiles(pisnge, mmd, 'storypoints-by-status-pie', options)
}

const rangeTo = (limit: number) => Array.from(new Array(limit), (_, i) => i)

const ucFirst = (str: string) => str[0].toLocaleUpperCase() + str.slice(1)

export async function makeRemainingStoryPointsLineChart(
  pisnge: Pisnge,
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
  const legendItems: string[] = []
  if (pointBuckets.hasStartedEvents) {
    plotColorPalette.push(statuses.inProgress.color)
    lines.push(`  line [${remainingPoints.started.join(', ')}]`)
    legendItems.push('In Progress')
  }
  if (pointBuckets.hasToReviewEvents) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${remainingPoints.toReview.join(', ')}]`)
    legendItems.push('In Review')
  }
  if (pointBuckets.hasDevelopedEvents) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${remainingPoints.developed.join(', ')}]`)
    legendItems.push('Ready for QA')
  }
  if (pointBuckets.hasDoneEvents) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${remainingPoints.done.join(', ')}]`)
    legendItems.push('Done')
  }

  const theme = {
    xyChart: {
      plotColorPalette: plotColorPalette.join(','),
      plotPoints: `'${rangeTo(lines.length)
        .map((_) => 'square')
        .join(',')}'`,
    },
  }

  const xAxisCount = (bucketCount ?? pointBuckets.maxBucketIndex) + 1
  const shownLabel = xAxisCount >= 10 ? label[0].toUpperCase() : ucFirst(label)
  const xAxis = rangeTo(xAxisCount)
    .map((i) => `"${shownLabel} ${i}"`)
    .join(', ')
  const width = xAxisCount >= 15 ? 1000 : 800

  const mmd =
    `%%{init: {'width': ${width}, 'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Story points remaining by ${label}"\n` +
    `  legend [${legendItems.join(', ')}]\n` +
    `  x-axis [${xAxis}]\n` +
    `  y-axis "Story points" ${minY} --> ${maxY}\n` +
    lines.join('\n')

  return makeChartFiles(pisnge, mmd, `remaining-storypoints-by-${label}`, options)
}

export async function makeVelocityChart(
  pisnge: Pisnge,
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
  const legendItems: string[] = []
  if (velocities.started.length) {
    plotColorPalette.push(statuses.inProgress.color)
    lines.push(`  line [${velocities.started.slice(1, -1).join(', ')}]`)
    legendItems.push('In Progress')
  }
  if (velocities.toReview.length) {
    plotColorPalette.push(statuses.inReview.color)
    lines.push(`  line [${velocities.toReview.slice(1, -1).join(', ')}]`)
    legendItems.push('In Progress')
  }
  if (velocities.developed.length) {
    plotColorPalette.push(statuses.readyForQA.color)
    lines.push(`  line [${velocities.developed.slice(1, -1).join(', ')}]`)
    legendItems.push('Ready for QA')
  }
  if (velocities.done.length) {
    plotColorPalette.push(statuses.done.color)
    lines.push(`  line [${velocities.done.slice(1, -1).join(', ')}]`)
    legendItems.push('Done')
  }

  const theme = {
    xyChart: {
      plotColorPalette: plotColorPalette.join(','),
      plotPoints: `'${rangeTo(lines.length)
        .map((_) => 'square')
        .join(',')}'`,
    },
  }

  const xAxisCount = velocities.started.length - 2
  const shownLabel = xAxisCount >= 10 ? 'W' : 'Week'
  const xAxis = rangeTo(xAxisCount)
    .map((i) => `"${shownLabel} ${i + 1}"`)
    .join(', ')
  const width = xAxisCount >= 15 ? 1000 : 800
  const mmd =
    `%%{init: {'width': ${width}, 'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Story point velocity by week"\n` +
    `  legend [${legendItems.join(', ')}]\n` +
    `  x-axis [${xAxis}]\n` +
    `  y-axis "Story points" 0 --> ${maxY}\n` +
    lines.join('\n')

  return makeChartFiles(pisnge, mmd, 'storypoint-velocity-by-week', options)
}

export async function makeOpenIssuesChart(
  pisnge: Pisnge,
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

  const sortedOpenIssues = [...openIssues.entries()]
    .map(([status, stat]) => ({ status, ...stat }))
    .sort((a, b) => b.daysReadyForQA - a.daysReadyForQA)
  const theme = {
    xyChart: {
      plotColorPalette: [statuses.inReview.color, statuses.readyForQA.color].join(', '),
    },
  }
  const inReviewBar = sortedOpenIssues.map((stat) => stat.daysReadyForReview)
  const readyForQABar = sortedOpenIssues.map((stat) => stat.daysReadyForQA)
  const maxX = Math.max(sortedOpenIssues[0].daysReadyForReview, sortedOpenIssues[0].daysReadyForQA)

  const width = sortedOpenIssues.length >= 15 ? 1000 : 800

  const mmd =
    `%%{init: {'width': ${width}, 'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%\n` +
    `xychart-beta\n` +
    `  title "Issues in review or ready for QA"\n` +
    `  legend [In Review, Ready for QA]\n` +
    `  x-axis [${[...sortedOpenIssues.map(({ status }) => status)].join(', ')}]\n` +
    `  y-axis "Number of days in status" 0 --> ${maxX}\n` +
    `  bar [${inReviewBar.join(', ')}]\n` +
    `  bar [${readyForQABar.join(', ')}]`

  return makeChartFiles(pisnge, mmd, 'open-issues', options)
}

export async function makeAverageWeelyVelocityByDeveloperChart(
  pisnge: Pisnge,
  issues: JiraIssue[],
  timePeriod: number,
  options: Options,
): Promise<Chart | undefined> {
  // map of time against map of dev complete story points by developer
  const events = new Map<number, Map<string, number>>()

  let firstStartedTime = Number.MAX_SAFE_INTEGER
  for (const issue of issues) {
    const { startedTime, storyPoints } = issue
    if (storyPoints && startedTime && startedTime < firstStartedTime) {
      firstStartedTime = startedTime
    }
  }
  if (firstStartedTime === Number.MAX_SAFE_INTEGER) return undefined

  const startTimes = new Map<string, number>()

  for (const issue of issues) {
    const { storyPoints, developer } = issue
    if (!storyPoints || !developer) continue

    const { devCompleteTime, startedTime } = issue
    if (startedTime) {
      const relativeTime = Math.max(Math.floor((startedTime - firstStartedTime) / timePeriod), 0)
      const previousStartTime = startTimes.get(developer)
      if (previousStartTime === undefined || relativeTime < previousStartTime) {
        startTimes.set(developer, relativeTime)
      }
    }

    if (devCompleteTime) {
      const relativeTime = Math.floor((devCompleteTime - firstStartedTime) / timePeriod)

      let timeBuckets = events.get(relativeTime)
      if (!timeBuckets) {
        timeBuckets = new Map()
        events.set(relativeTime, timeBuckets)
      }
      timeBuckets.set(developer, (timeBuckets.get(developer) ?? 0) + storyPoints)
    }
  }

  // need at least 3 weeks to calculate this data
  // the first week may be incomplete if a developer started mid-week, and the last week may
  // be incomplete if the report was generated during that week
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
  if (!velocities.size) return undefined

  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(DEFAULT_PIE_CHART_THEME)}}}%%\n` +
    `pie showData title Average weekly story point velocity\n` +
    Array.from(velocities.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([developer, points]) => `  "${developer}": ${points.toFixed(1)}\n`)
      .join('')

  return makeChartFiles(
    pisnge,
    mmd,
    'average-weekly-storypoint-velocity-per-developer-pie',
    options,
  )
}

export async function makeVelocityByDeveloperChart(
  pisnge: Pisnge,
  issues: JiraIssue[],
  periodsAgo: number,
  period: Period,
  periodCount: number,
  options: Options,
): Promise<Chart | undefined> {
  const velocities = new Map<string, number>()
  const periodLength = PERIOD_LENGTHS[period]

  const endTime = Date.now() - periodsAgo * periodLength
  const startTime = endTime - periodCount * periodLength

  for (const issue of issues) {
    const { storyPoints, developer } = issue
    if (!storyPoints || !developer) continue

    const { devCompleteTime } = issue

    if (devCompleteTime && devCompleteTime > startTime && devCompleteTime < endTime) {
      velocities.set(developer, (velocities.get(developer) ?? 0) + storyPoints)
    }
  }
  if (!velocities.size) return undefined

  let label: string = period
  if (periodsAgo === 0) {
    label = `this ${label}`
  } else if (periodsAgo === 1) {
    label = `last ${label}`
  } else {
    label = `${periodsAgo} ${label}s ago`
  }
  const filenameLabel = label.replace(/ /g, '-')

  const mmd =
    `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(DEFAULT_PIE_CHART_THEME)}}}%%\n` +
    `pie showData title Story point velocity ${label}\n` +
    Array.from(velocities.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([developer, points]) => `  "${developer}": ${points}\n`)
      .join('')

  return makeChartFiles(
    pisnge,
    mmd,
    `storypoint-velocity-per-developer-${filenameLabel}-pie`,
    options,
  )
}

export async function makeWorkItemChangesChart(
  pisnge: Pisnge,
  changes: IssueChange[] | undefined,
  period: Period,
  options: Options,
): Promise<Chart | undefined> {
  if (!changes?.length) return undefined

  const changeRows = changes.map((change) => {
    return `  ${change.key} ${change.formerStatus ?? 'Not Existing'}: ${change.formerStoryPoints ?? 0} -> ${change.status ?? 'Not Existing'}: ${change.storyPoints ?? 0}`
  })

  // TODO: generate columns dynamically based on configured statuses
  const mmd =
    "%%{init: { 'width': 1100 }}%%\nwork-item-movement\n" +
    `  title 'Work item changes since previous ${period}'\n` +
    '  columns [Not Existing, Draft, Blocked, To Do, In Progress, In Review, Ready for QA, In Test, Done]\n' +
    changeRows.join('\n')

  return makeChartFiles(pisnge, mmd, `work-item-changes-${period}`, options)
}

const straightLine = (length: number, total: number): number[] => {
  const gap = total / length
  return rangeTo(length).map((i) => (i + 1) * gap)
}

export async function makeSprintBurnUpChart(
  pisnge: Pisnge,
  boardId: string,
  dataDir: string,
  options: Options,
  fieldIds: FieldIds,
): Promise<Chart | undefined> {
  const { sprintId, startDate, endDate } = await getCurrentSprintIdAndConfig(options, boardId)
  const sprintsPath = pathJoin(dataDir, 'sprints', boardId, sprintId.toString())

  const daysFromStartDate = workDaysBetween(startDate, new Date(), options.workDays)
  if (daysFromStartDate < 0.5) {
    // less than half a day into the sprint so don't produce a chart
    return undefined
  }

  // round i.e. if 1.5 days from the start of the sprint then also produce a report
  // for the final day even though we're only half a day through it
  const dayCount = Math.round(daysFromStartDate)
  const jiraIssuesEachDay: JiraIssue[][] = []

  // the first stored date will be for the sprint day + 1
  const historicalDayCount = dayCount - 1
  let nextDate = getNextWorkDay(startDate, options.workDays)
  for (let i = 0; i < historicalDayCount; ++i) {
    // read historical issues for past work day
    // console.log('reading historical data for', formatDate(nextDate))
    const dayPath = pathJoin(sprintsPath, formatDate(nextDate), 'jira.json')
    jiraIssuesEachDay.push(JSON.parse((await readFile(dayPath)).toString()))
    nextDate = getNextWorkDay(nextDate, options.workDays)
  }

  // console.log('reading today's data for', formatDate(nextDate))
  const sprintPathForToday = pathJoin(sprintsPath, formatDate(nextDate))
  const sprintIssuesToday = await fetchIssuesFromSprint(options, fieldIds, sprintId)
  await mkdir(sprintPathForToday, { recursive: true })
  await writeFile(pathJoin(sprintPathForToday, 'jira.json'), JSON.stringify(sprintIssuesToday))
  jiraIssuesEachDay.push(sprintIssuesToday)

  const commitmentPerDay: number[] = []
  const readyForQAPointsPerDay: number[] = []
  const donePointsPerDay: number[] = []

  for (const jiraIssues of jiraIssuesEachDay) {
    let commitment = 0
    let readyForQAPoints = 0
    let donePoints = 0

    for (const issue of jiraIssues) {
      commitment += issue.storyPoints
      if (issue.devCompleteTime) readyForQAPoints += issue.storyPoints
      if (issue.endTime) donePoints += issue.storyPoints
    }

    commitmentPerDay.push(commitment)
    readyForQAPointsPerDay.push(readyForQAPoints)
    donePointsPerDay.push(donePoints)
  }

  const sprintDayCount = Math.round(workDaysBetween(startDate, endDate, options.workDays))
  const maxStoryPoints = Math.max(...commitmentPerDay)
  commitmentPerDay.push(
    ...Array(sprintDayCount - commitmentPerDay.length).fill(commitmentPerDay.at(-1)),
  )

  const plotColors = ['#cccccc', '#4c82db', '#9c1de9', '#038411']
  const legend = ['Target', 'Commitment', 'Ready for QA', 'Done']
  const plotPoints = ['none', 'diamond', 'square', 'square']
  const strokeStyles = ['dashed', 'solid', 'solid', 'solid']

  const lines = [
    straightLine(sprintDayCount, commitmentPerDay.at(-1)!),
    commitmentPerDay,
    readyForQAPointsPerDay,
    donePointsPerDay,
  ]

  if (commitmentPerDay[0] !== commitmentPerDay.at(-1)) {
    lines.unshift(straightLine(sprintDayCount, commitmentPerDay[0]))
    plotColors.unshift('#aaaaaa')
    legend.unshift('Original Target')
    plotPoints.unshift('none')
    strokeStyles.unshift('dashed')
  }

  const xAxis = rangeTo(sprintDayCount).map((i) => `Day ${i + 1}`)

  const mmd = `%%{init: {
  'width': 1000,
  'theme': 'base',
  'themeVariables': {
    "xyChart":{
      "plotColorPalette":"${plotColors.join(',')}",
      "plotPoints":"${plotPoints.join(',')}",
      "strokeStyles":"${strokeStyles.join(',')}",
    }
  }
}}%%
xychart-beta
  title "Burn-up chart"
  legend [${legend.join(', ')}]
  x-axis [${xAxis.join(', ')}]
  y-axis "Story points" 0 --> ${maxStoryPoints}
${lines.map((line) => `  line [${line.join(', ')}]`).join('\n')}`

  return makeChartFiles(pisnge, mmd, `sprint-burn-up-${boardId}`, options)
}
