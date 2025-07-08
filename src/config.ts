import { getInput } from '@actions/core'

export interface Status {
  name: string
  color: string
}

export interface Statuses {
  draft: Status
  blocked: Status
  todo: Status
  inProgress: Status
  inReview: Status
  readyForQA: Status
  inTest: Status
  done: Status
}

export interface JiraFields {
  storyPoints: string
  startTime: string
  readyForReviewTime: string
  devCompleteTime: string
  endTime: string
  developer: string
}

// have to write the files because the mermaid API requires that
const OUTPUT_DIRECTORY = 'charts'

const DEFAULT_CHART_NAMES = [
  'remaining-by-day',
  'by-status',
  'remaining-by-week',
  'in-review-and-test',
  'weekly-velocity',
] as const

const DEFAULT_CHARTS: ChartConfig[] = DEFAULT_CHART_NAMES.map((name) => ({
  name,
  config: {},
}))

const CHART_NAMES = [
  ...DEFAULT_CHART_NAMES,
  'velocity-by-developer',
  'velocity-by-developer-this-week',
  'velocity-by-developer-last-week',
  'daily-work-item-changes',
  'weekly-work-item-changes',
  'sprint-burn-up',
] as const

export interface ChartConfig {
  name: ChartName
  config: Record<string, string>
}

export type ChartName = (typeof CHART_NAMES)[number]

export interface Options {
  channel?: string
  charts: ChartConfig[]
  output: string
  storyPointEstimate: number
  noImages?: boolean
  statuses: Statuses
  jiraBaseUrl: string
  jiraAuth: string
  jiraFields: JiraFields
  jql: string
  slackToken: string
  summary: string
  withDailyDescription: string
  withWeeklyDescription: string
  storeWorkItemHistory?: string
  workDays: Set<number>
}

const DEFAULT_STATUSES: Statuses = {
  draft: { name: 'draft', color: '#8fa3bf' },
  blocked: { name: 'blocked', color: '#ff1493' },
  todo: { name: 'to do', color: '#f15a50' },
  inProgress: { name: 'in progress', color: '#038411' },
  inReview: { name: 'in review', color: '#ff8b00' },
  readyForQA: { name: 'ready for qa', color: '#9c1de9' },
  inTest: { name: 'in test', color: '#4b0082' },
  done: { name: 'done', color: '#43acd9' },
}

const DEFAULT_JIRA_FIELDS: JiraFields = {
  storyPoints: 'story points',
  devCompleteTime: 'development complete time',
  startTime: 'start time',
  readyForReviewTime: 'ready for review time',
  endTime: 'resolutiondate',
  developer: 'developer',
}

const DEFAULT_JQL = 'fixVersion = earliestUnreleasedVersion()'

interface ConfigValue {
  name: string
  value: string
  line: string
}

const parseYamlLikeFields = (configName: string, configValue: string): ConfigValue[] => {
  const values: ConfigValue[] = []
  for (const rawLine of configValue.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const [name, rawValue] = line.split(/ *: */)
    const value = rawValue?.trim().toLocaleLowerCase()
    if (!name || !name) {
      throw new Error(`Invalid line in ${configName} configuration: "${line}"`)
    }

    values.push({ name, value, line })
  }
  return values
}

export function parseOptions(): Options {
  const channel = getInput('slack-channel', { required: true })
  const chartsRaw = getInput('charts')
  const storyPointEstimateRaw = getInput('story-point-estimate')
  const jiraUser = getInput('jira-user', { required: true })
  const jiraBaseUrl = getInput('jira-base-url', { required: true })
  const jiraToken = getInput('jira-token', { required: true })
  const slackToken = getInput('slack-token', { required: true })
  const jiraFieldsRaw = getInput('jira-fields')
  const jiraStatusesRaw = getInput('jira-statuses')
  const jql = getInput('jql') || DEFAULT_JQL
  const summary = getInput('summary')
  const withDailyDescription = getInput('with-daily-description')
  const withWeeklyDescription = getInput('with-weekly-description')
  const storeWorkItemHistory = getInput('store-work-item-history')
  const workDaysRaw = getInput('work-days')

  const charts = DEFAULT_CHARTS
  if (!/^\s*$/.test(chartsRaw)) {
    charts.splice(0)
    let currentChartConfig: Record<string, string> = {}
    let previousChartNeedsConfig = false
    const chartConfigLines = chartsRaw.split(/\n/)
    for (let i = 0; i < chartConfigLines.length; ++i) {
      const chartConfigLine = chartConfigLines[i].trim()
      if (!chartConfigLine) continue

      if (!chartConfigLine.startsWith('-')) {
        if (!previousChartNeedsConfig) {
          throw new Error(`Invalid chart configuration line: ${chartConfigLines}`)
        }

        let [configKey, configVal] = chartConfigLine.split(':')
        configKey = configKey.trim()
        configVal = configVal.trim()
        if (!configKey || !configVal) {
          throw new Error(`Invalid chart configuration line: ${chartConfigLines}`)
        }
        currentChartConfig[configKey] = configVal
        continue
      }

      previousChartNeedsConfig = false
      currentChartConfig = {}
      let chartNameConfig = chartConfigLine.slice(1).trim()
      if (chartNameConfig.endsWith(':')) {
        previousChartNeedsConfig = true
        chartNameConfig = chartNameConfig.slice(0, -1)
      }

      const chartName = chartNameConfig as ChartName
      if (!CHART_NAMES.includes(chartName))
        throw new Error(`Chart type ${chartName} is not supported`)
      charts.push({ name: chartName, config: currentChartConfig })
    }
  }

  if (
    charts.find(({ name }) => name === 'daily-work-item-changes') ||
    charts.find(({ name }) => name === 'weekly-work-item-changes') ||
    charts.find(({ name }) => name === 'sprint-burn-up')
  ) {
    if (!storeWorkItemHistory) {
      throw new Error(
        "Cannot use 'daily-work-item-changes', 'weekly-work-item-changes' or 'sprint-burn-up' charts without 'store-work-item-history' option",
      )
    }
  }

  const jiraFields = { ...DEFAULT_JIRA_FIELDS }
  if (jiraFieldsRaw) {
    const fieldMap = {
      'story-points': 'storyPoints',
      'start-time': 'storyPoints',
      'ready-for-review-time': 'readyForReviewTime',
      'dev-complete-time': 'devCompleteTime',
      'end-time': 'endTime',
      developer: 'developer',
    } as const

    for (const { name, value, line } of parseYamlLikeFields('jira-fields', jiraFieldsRaw)) {
      const configName = fieldMap[name as keyof typeof fieldMap]
      if (!configName) {
        throw new Error(`Unsupported field name "${name}" in jira-fields configuration: "${line}"`)
      }
      jiraFields[configName] = value
    }
  }

  const statuses = jiraStatusesRaw
    ? (Object.fromEntries(
        Object.entries(DEFAULT_STATUSES).map(([name, value]) => [name, { ...value }]),
      ) as Statuses)
    : DEFAULT_STATUSES
  if (jiraStatusesRaw) {
    const statusMap = {
      draft: 'draft',
      blocked: 'blocked',
      todo: 'todo',
      'in-progress': 'inProgress',
      'in-review': 'inReview',
      'ready-for-qa': 'readyForQA',
      'in-test': 'inTest',
      done: 'done',
    } as const
    for (const { name, value, line } of parseYamlLikeFields('jira-statuses', jiraStatusesRaw)) {
      const configName = statusMap[name as keyof typeof statusMap]
      if (!configName) {
        throw new Error(`Unsupported status name "${name}" in jira-fields configuration: "${line}"`)
      }
      const status = statuses[configName]
      if (value.startsWith('#')) {
        status.color = value
      } else {
        const colorIndex = value.lastIndexOf('#')
        if (colorIndex === -1) {
          status.name = value.toLocaleLowerCase()
        } else {
          status.color = value.slice(colorIndex).trim()
          status.name = value.slice(0, colorIndex).trim().toLocaleLowerCase()
        }
      }
    }
  }

  const workDays = new Set([1, 2, 3, 4, 5])
  if (workDaysRaw) {
    workDays.clear()
    for (const workDayStr of workDaysRaw.split('')) {
      const workDay = parseInt(workDayStr)
      if (isNaN(workDay) || workDay > 6) {
        throw new Error('Invalid work-days configuration, should be a string like 12345')
      }
      workDays.add(workDay)
    }
  }

  const storyPointEstimate = storyPointEstimateRaw ? parseInt(storyPointEstimateRaw) : 0
  return {
    channel: channel,
    charts,
    output: OUTPUT_DIRECTORY,
    storyPointEstimate,
    statuses,
    jiraBaseUrl,
    jiraAuth: Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64'),
    slackToken,
    jiraFields,
    jql,
    summary,
    withDailyDescription,
    withWeeklyDescription,
    storeWorkItemHistory,
    workDays,
  }
}
