import { parseOptions } from './config'
import { fetchIssues } from './jira'

async function validateJiraIssues() {
  const options = await parseOptions()

  const issues = await fetchIssues(options)

  for (const issue of issues) {
    const { key, startedTime, resolutionTime, devCompleteTime } = issue

    if (resolutionTime && !startedTime) {
      console.warn('issue', key, 'was resolved but not started')
    } else if (resolutionTime && resolutionTime < startedTime!) {
      console.warn('issue', key, 'was resolved before it started')
    }

    if (resolutionTime && !devCompleteTime) {
      console.warn('issue', key, 'was resolved but not dev complete')
    } else if (resolutionTime && resolutionTime < devCompleteTime!) {
      console.warn('issue', key, 'was resolved before it was dev complete')
    }

    if (devCompleteTime && !startedTime) {
      console.warn('issue', key, 'was dev complete but not started')
    } else if (devCompleteTime && devCompleteTime < startedTime!) {
      console.warn('issue', key, 'was dev complete before it was started')
    }
  }
}

await validateJiraIssues()
