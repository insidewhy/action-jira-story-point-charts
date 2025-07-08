import { JiraFields, Options, Statuses } from './config'

export interface FieldIds {
  storyPoints: string
  startTime?: string
  readyForReviewTime?: string
  devCompleteTime?: string
  endTime: string
  developer?: string
}

export interface JiraIssue {
  key: string
  type: string
  status: string
  storyPoints: number
  createdTime: number
  startedTime: number | undefined
  readyForReviewTime: number | undefined
  devCompleteTime: number | undefined
  endTime: number | undefined
  developer: string | undefined
}

async function makeJiraApiRequest(
  auth: string,
  baseUrl: string,
  apiPath: string,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await fetch(`${baseUrl}/rest/${apiPath}/${path}`, {
    headers: { authorization: `Basic ${auth}` },
  })
  if (!response.ok) {
    throw new Error('Could not contact jira')
  }
  return response.json()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeJiraApiV3Request = (auth: string, baseUrl: string, path: string): Promise<any> =>
  makeJiraApiRequest(auth, baseUrl, 'api/3', path)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeJiraAgileRequest = (auth: string, baseUrl: string, path: string): Promise<any> =>
  makeJiraApiRequest(auth, baseUrl, 'agile/1.0', path)

export async function getJiraFieldIds(
  auth: string,
  baseUrl: string,
  fields: JiraFields,
): Promise<FieldIds> {
  const fieldMetadata: Array<{ name: string; id: string }> = await makeJiraApiV3Request(
    auth,
    baseUrl,
    'field',
  )
  let storyPoints = ''
  let startTime: string | undefined
  let readyForReviewTime: string | undefined
  let devCompleteTime: string | undefined
  let endTime: string | undefined
  let developer: string | undefined
  for (const field of fieldMetadata) {
    const fieldName = field.name.toLocaleLowerCase()
    if (fieldName === fields.storyPoints) storyPoints = field.id
    else if (fieldName === fields.devCompleteTime) devCompleteTime = field.id
    else if (fieldName === fields.startTime) startTime = field.id
    else if (fieldName === fields.readyForReviewTime) readyForReviewTime = field.id
    else if (fieldName === fields.endTime) endTime = field.id
    else if (fieldName === fields.developer) developer = field.id
  }

  if (!storyPoints) {
    throw new Error(`Could not find "${fields.storyPoints}" field`)
  }
  if (!endTime) {
    if (fields.endTime === 'resolutiondate') {
      // it's a special kind of field that's tied to the `resolution` field, it doesn't appear
      // in the field list
      endTime = 'resolutiondate'
    } else {
      throw new Error(`Could not find "${fields.endTime}" field`)
    }
  }

  return { storyPoints, startTime, readyForReviewTime, devCompleteTime, endTime, developer }
}

function fetchIssuesPage(auth: string, baseUrl: string, jql: string, offset = 0) {
  return makeJiraApiV3Request(auth, baseUrl, `search?jql=${jql}&startAt=${offset}`)
}

async function processJiraIssues(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jiraIssues: any[],
  fieldIds: FieldIds,
  statuses: Statuses,
  storyPointEstimate: number,
): Promise<JiraIssue[]> {
  const processedIssues: JiraIssue[] = []
  for (const issue of jiraIssues) {
    const type = issue.fields.issuetype.name
    if (type === 'Epic') continue

    const storyPoints = issue.fields[fieldIds.storyPoints] ?? storyPointEstimate
    if (storyPoints === 0) continue

    const status = issue.fields.status.name
    const lcStatus = status.toLocaleLowerCase()

    const developer = fieldIds.developer ? issue.fields[fieldIds.developer]?.displayName : undefined

    let endTime: number | undefined
    if (lcStatus === statuses.done.name) {
      const endTimeString: string | undefined = issue.fields[fieldIds.endTime]
      endTime = endTimeString ? new Date(endTimeString).getTime() : undefined
    }

    let devCompleteTime: number | undefined
    if (fieldIds.devCompleteTime) {
      if (
        lcStatus === statuses.done.name ||
        lcStatus === statuses.inTest.name ||
        lcStatus === statuses.readyForQA.name
      ) {
        const devCompletedTimeString: string | undefined = issue.fields[fieldIds.devCompleteTime]
        devCompleteTime = devCompletedTimeString
          ? new Date(devCompletedTimeString).getTime()
          : undefined
      }
    }

    let readyForReviewTime: number | undefined
    if (fieldIds.readyForReviewTime) {
      if (
        lcStatus === statuses.done.name ||
        lcStatus === statuses.inTest.name ||
        lcStatus === statuses.readyForQA.name ||
        lcStatus === statuses.inReview.name
      ) {
        const readyForReviewTimeString: string | undefined =
          issue.fields[fieldIds.readyForReviewTime]
        readyForReviewTime = readyForReviewTimeString
          ? new Date(readyForReviewTimeString).getTime()
          : undefined
      }
    }

    let startedTime: number | undefined
    if (fieldIds.startTime) {
      if (
        lcStatus === statuses.done.name ||
        lcStatus === statuses.inTest.name ||
        lcStatus === statuses.readyForQA.name ||
        lcStatus === statuses.inReview.name ||
        lcStatus === statuses.inProgress.name
      ) {
        const startedTimeString: string | undefined = issue.fields[fieldIds.startTime]
        startedTime = startedTimeString ? new Date(startedTimeString).getTime() : undefined
      }
    }

    processedIssues.push({
      key: issue.key,
      type,
      status,
      storyPoints,
      endTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
      createdTime: new Date(issue.fields.created).getTime(),
      developer,
    })
  }

  return processedIssues
}

export async function fetchIssues(options: Options, fieldIds: FieldIds): Promise<JiraIssue[]> {
  const { jiraAuth: auth, jiraBaseUrl: baseUrl } = options
  const jql = encodeURIComponent(options.jql)

  const firstPage = await fetchIssuesPage(auth, baseUrl, jql)
  const { issues } = firstPage
  const total = firstPage.total
  while (issues.length < total) {
    const nextPage = await fetchIssuesPage(auth, baseUrl, jql, issues.length)
    issues.push(...nextPage.issues)
  }

  return processJiraIssues(issues, fieldIds, options.statuses, options.storyPointEstimate)
}

export async function getCurrentSprintIdAndConfig(
  options: Options,
  boardId: string,
): Promise<{ sprintId: number; startDate: Date; endDate: Date }> {
  const response = await makeJiraAgileRequest(
    options.jiraAuth,
    options.jiraBaseUrl,
    `board/${boardId}/sprint?state=active`,
  )

  if (
    !Array.isArray(response.values) ||
    response.values.length !== 1 ||
    typeof response.values[0].id !== 'number'
  ) {
    throw new Error('Could not get current sprint id')
  }

  const sprint = response.values[0]
  return {
    sprintId: sprint.id,
    startDate: new Date(sprint.startDate),
    endDate: new Date(sprint.endDate),
  }
}

function fetchSprintIssues(auth: string, baseUrl: string, sprintId: number, offset = 0) {
  return makeJiraAgileRequest(auth, baseUrl, `sprint/${sprintId}/issue?startAt=${offset}`)
}

export async function fetchIssuesFromSprint(
  options: Options,
  fieldIds: FieldIds,
  sprintId: number,
): Promise<JiraIssue[]> {
  const { jiraAuth: auth, jiraBaseUrl: baseUrl } = options

  const firstPage = await fetchSprintIssues(auth, baseUrl, sprintId)
  const { issues } = firstPage
  const total = firstPage.total
  while (issues.length < total) {
    const nextPage = await fetchSprintIssues(auth, baseUrl, sprintId, issues.length)
    issues.push(...nextPage.issues)
  }

  return processJiraIssues(issues, fieldIds, options.statuses, options.storyPointEstimate)
}
