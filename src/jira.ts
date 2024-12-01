import { JiraFields, Options } from './config'

interface FieldIds {
  storyPoints: string
  readyForReviewTime?: string
  devCompleteTime?: string
  startTime?: string
}

export interface JiraIssue {
  key: string
  type: string
  status: string
  storyPoints: number
  resolutionTime: number | undefined
  readyForReviewTime: number | undefined
  devCompleteTime: number | undefined
  startedTime: number | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeJiraApiRequest(auth: string, baseUrl: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl}/rest/api/3/${path}`, {
    headers: { authorization: `Basic ${auth}` },
  })
  if (!response.ok) {
    throw new Error('Could not contact jira')
  }
  return response.json()
}

async function getCustomFields(
  auth: string,
  baseUrl: string,
  fields: JiraFields,
): Promise<FieldIds> {
  const fieldMetadata: Array<{ name: string; id: string }> = await makeJiraApiRequest(
    auth,
    baseUrl,
    'field',
  )
  let storyPoints = ''
  let devCompleteTime: string | undefined
  let startTime: string | undefined
  let readyForReviewTime: string | undefined
  for (const field of fieldMetadata) {
    const fieldName = field.name.toLocaleLowerCase()
    if (fieldName === fields.storyPoints) storyPoints = field.id
    else if (fieldName === fields.devCompleteTime) devCompleteTime = field.id
    else if (fieldName === fields.startTime) startTime = field.id
    else if (fieldName === fields.readyForReviewTime) readyForReviewTime = field.id
  }

  if (!storyPoints) {
    throw new Error(`Could not find "${fields.storyPoints}" field`)
  }

  return { storyPoints, devCompleteTime, readyForReviewTime, startTime }
}

function fetchIssuesPage(auth: string, baseUrl: string, jql: string, offset = 0) {
  return makeJiraApiRequest(auth, baseUrl, `search?jql=${jql}&startAt=${offset}`)
}

export async function fetchIssues(options: Options): Promise<JiraIssue[]> {
  const { jiraAuth: auth, jiraBaseUrl: baseUrl, jql: rawJql, statuses } = options
  const jql = encodeURIComponent(rawJql)

  const fieldIds = await getCustomFields(auth, baseUrl, options.jiraFields)

  const firstPage = await fetchIssuesPage(auth, baseUrl, jql)
  const { issues } = firstPage
  const total = firstPage.total
  while (issues.length < total) {
    const nextPage = await fetchIssuesPage(auth, baseUrl, jql, issues.length)
    issues.push(...nextPage.issues)
  }

  const processedIssues: JiraIssue[] = []
  for (const issue of issues) {
    const type = issue.fields.issuetype.name
    if (type === 'Epic') continue

    const storyPoints = issue.fields[fieldIds.storyPoints] ?? options.storyPointEstimate
    if (storyPoints === 0) continue

    const status = issue.fields.status.name
    const lcStatus = status.toLocaleLowerCase()

    let resolutionTime: number | undefined
    if (lcStatus === statuses.done.name) {
      const resolutionDate: string | undefined = issue.fields.resolutiondate
      resolutionTime = resolutionDate ? new Date(resolutionDate).getTime() : undefined
    }

    let devCompleteTime: number | undefined
    if (fieldIds.devCompleteTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.readyForQA.name) {
        const devCompletedDate: string | undefined = issue.fields[fieldIds.devCompleteTime]
        devCompleteTime = devCompletedDate ? new Date(devCompletedDate).getTime() : undefined
      }
    }

    let readyForReviewTime: number | undefined
    if (fieldIds.readyForReviewTime) {
      if (
        lcStatus === statuses.done.name ||
        lcStatus === statuses.readyForQA.name ||
        lcStatus === statuses.inReview.name
      ) {
        const readyForReviewDate: string | undefined = issue.fields[fieldIds.readyForReviewTime]
        readyForReviewTime = readyForReviewDate ? new Date(readyForReviewDate).getTime() : undefined
      }
    }

    let startedTime: number | undefined
    if (fieldIds.startTime) {
      if (
        lcStatus === statuses.done.name ||
        lcStatus === statuses.readyForQA.name ||
        lcStatus === statuses.inReview.name ||
        lcStatus === statuses.inProgress.name
      ) {
        const startedDate: string | undefined = issue.fields[fieldIds.startTime]
        startedTime = startedDate ? new Date(startedDate).getTime() : undefined
      }
    }

    processedIssues.push({
      key: issue.key,
      type,
      status,
      storyPoints,
      resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
    })
  }

  return processedIssues
}
