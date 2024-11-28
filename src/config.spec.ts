import * as actionsCore from '@actions/core'
import { munamuna } from 'munamuna'
import { beforeEach, expect, it, vi } from 'vitest'

import { Options, parseOptions } from './config'

vi.mock('@actions/core', () => ({}))

const getInputMock = munamuna(actionsCore).getInput

beforeEach(() => {
  vi.clearAllMocks()
})

type MockConfig = Partial<
  Omit<Options, 'storyPointEstimate' | 'output' | 'statuses' | 'jiraAuth' | 'jiraFields' | 'jql'>
> & {
  storyPointEstimate?: string
  jiraFields?: string
}

const DEFAULT_CONFIG = {
  slackChannel: 'slack',
  jiraUser: 'jira-user',
  jiraBaseUrl: 'https://test.jira.com',
  jiraToken: 'jira-token',
  slackToken: 'slack-token',
}

function mockConfig(config: MockConfig = DEFAULT_CONFIG): void {
  const mockedConfig = { ...DEFAULT_CONFIG, ...config }

  getInputMock.mockReturnValueOnce(mockedConfig.slackChannel)
  getInputMock.mockReturnValueOnce(mockedConfig.storyPointEstimate ?? '')
  getInputMock.mockReturnValueOnce(mockedConfig.jiraUser)
  getInputMock.mockReturnValueOnce(mockedConfig.jiraBaseUrl)
  getInputMock.mockReturnValueOnce(mockedConfig.jiraToken)
  getInputMock.mockReturnValueOnce(mockedConfig.slackToken)
  getInputMock.mockReturnValueOnce(mockedConfig.jiraFields ?? '')
}

it('can parse entire config', () => {
  mockConfig({ storyPointEstimate: '5' })
  const config = parseOptions()
  expect(config).toEqual({
    channel: DEFAULT_CONFIG.slackChannel,
    output: 'charts',
    storyPointEstimate: 5,
    jiraBaseUrl: DEFAULT_CONFIG.jiraBaseUrl,
    jiraAuth: 'amlyYS11c2VyOmppcmEtdG9rZW4=',
    jiraFields: {
      storyPoints: 'story points',
      devCompleteTime: 'development complete time',
      startTime: 'start time',
    },
    slackToken: DEFAULT_CONFIG.slackToken,
    jql: 'fixVersion = earliestUnreleasedVersion()',
    statuses: {
      draft: { name: 'Draft', color: '#388bff' },
      todo: { name: 'To Do', color: '#f15a50' },
      inProgress: { name: 'In Progress', color: '#038411' },
      inReview: { name: 'In Review', color: '#ff8b00' },
      readyForQA: { name: 'Ready for QA', color: '#9c1de9' },
      done: { name: 'Done', color: '#43acd9' },
    },
  })
})

it('can override jira fields', () => {
  mockConfig({
    jiraFields: `
      storyPoints: your friend
      devCompleteTime: My Banana
    `,
  })

  const config = parseOptions()
  expect(config.jiraFields).toEqual({
    storyPoints: 'your friend',
    devCompleteTime: 'my banana',
    startTime: 'start time',
  })
})
