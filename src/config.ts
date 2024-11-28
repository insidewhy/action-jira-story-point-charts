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
  devComplete: string
  startTime: string
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
  draft: { name: 'Draft', color: '#388bff' },
  todo: { name: 'To Do', color: '#f15a50' },
  inProgress: { name: 'In Progress', color: '#038411' },
  inReview: { name: 'In Review', color: '#ff8b00' },
  readyForQA: { name: 'Ready for QA', color: '#9c1de9' },
  done: { name: 'Done', color: '#43acd9' },
}

const DEFAULT_JIRA_FIELDS: JiraFields = {
  storyPoints: 'Story Points',
  devComplete: 'Development Complete Time',
  startTime: 'Start time',
}

export function parseOptions(): Options {
  const channel = getInput('slack-channel', { required: true })
  const storyPointEstimateRaw = getInput('story-point-estimate')
  const jiraUser = getInput('jira-user', { required: true })
  const jiraBaseUrl = getInput('jira-base-url', { required: true })
  const jiraToken = getInput('jira-token', { required: true })
  const slackToken = getInput('slack-token', { required: true })

  const storyPointEstimate = storyPointEstimateRaw ? parseInt(storyPointEstimateRaw) : 0

  return {
    channel: channel,
    output: OUTPUT_DIRECTORY,
    storyPointEstimate,
    statuses: DEFAULT_STATUSES,
    jiraBaseUrl,
    jiraAuth: Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64'),
    jiraFields: DEFAULT_JIRA_FIELDS,
    jql: 'fixVersion = earliestUnreleasedVersion()',
    slackToken,
  }
}
