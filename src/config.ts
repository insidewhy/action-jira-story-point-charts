import { getInput } from '@actions/core'

interface Status {
  name: string
  color: string
}

interface Statuses {
  draft: Status
  todo: Status
  inProgress: Status
  inReview: Status
  readyForQA: Status
  done: Status
}

export interface JiraFields {
  storyPoints: string
  startTime: string
  readyForReviewTime: string
  devCompleteTime: string
  endTime: string
}

export interface Options {
  channel?: string
  output: string
  storyPointEstimate: number
  noImages?: boolean
  statuses: Statuses
  jiraBaseUrl: string
  jiraAuth: string
  jiraFields: JiraFields
  jql: string
  slackToken: string
}

// have to write the files because the mermaid API requires that
const OUTPUT_DIRECTORY = 'charts'

const DEFAULT_STATUSES: Statuses = {
  draft: { name: 'draft', color: '#388bff' },
  todo: { name: 'to do', color: '#f15a50' },
  inProgress: { name: 'in progress', color: '#038411' },
  inReview: { name: 'in review', color: '#ff8b00' },
  readyForQA: { name: 'ready for qa', color: '#9c1de9' },
  done: { name: 'done', color: '#43acd9' },
}

const DEFAULT_JIRA_FIELDS: JiraFields = {
  storyPoints: 'story points',
  devCompleteTime: 'development complete time',
  startTime: 'start time',
  readyForReviewTime: 'ready for review time',
  endTime: 'resolutiondate',
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
  const storyPointEstimateRaw = getInput('story-point-estimate')
  const jiraUser = getInput('jira-user', { required: true })
  const jiraBaseUrl = getInput('jira-base-url', { required: true })
  const jiraToken = getInput('jira-token', { required: true })
  const slackToken = getInput('slack-token', { required: true })
  const jiraFieldsRaw = getInput('jira-fields')
  const jiraStatusesRaw = getInput('jira-statuses')
  const jql = getInput('jql') || DEFAULT_JQL

  const jiraFields = { ...DEFAULT_JIRA_FIELDS }
  if (jiraFieldsRaw) {
    const fieldMap = {
      'story-points': 'storyPoints',
      'start-time': 'storyPoints',
      'ready-for-review-time': 'readyForReviewTime',
      'dev-complete-time': 'devCompleteTime',
      'end-time': 'endTime',
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
      todo: 'todo',
      'in-progress': 'inProgress',
      'in-review': 'inReview',
      'ready-for-qa': 'readyForQA',
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

  const storyPointEstimate = storyPointEstimateRaw ? parseInt(storyPointEstimateRaw) : 0
  return {
    channel: channel,
    output: OUTPUT_DIRECTORY,
    storyPointEstimate,
    statuses,
    jiraBaseUrl,
    jiraAuth: Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64'),
    slackToken,
    jiraFields,
    jql,
  }
}
