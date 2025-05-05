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
  Omit<
    Options,
    'storyPointEstimate' | 'output' | 'statuses' | 'jiraAuth' | 'jiraFields' | 'jiraStatuses'
  >
> & {
  storyPointEstimate?: string
  jiraFields?: string
  jiraStatuses?: string
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
  getInputMock.mockReturnValueOnce(mockedConfig.jiraStatuses ?? '')
  getInputMock.mockReturnValueOnce(mockedConfig.jql ?? '')
  getInputMock.mockReturnValueOnce(mockedConfig.summary ?? '')
  getInputMock.mockReturnValueOnce(mockedConfig.withDailyDescription ?? '')
  getInputMock.mockReturnValueOnce(mockedConfig.withWeeklyDescription ?? '')
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
      startTime: 'start time',
      readyForReviewTime: 'ready for review time',
      devCompleteTime: 'development complete time',
      endTime: 'resolutiondate',
    },
    slackToken: DEFAULT_CONFIG.slackToken,
    jql: 'fixVersion = earliestUnreleasedVersion()',
    statuses: {
      draft: { name: 'draft', color: '#8fa3bf' },
      blocked: { name: 'blocked', color: '#ff1493' },
      todo: { name: 'to do', color: '#f15a50' },
      inProgress: { name: 'in progress', color: '#038411' },
      inReview: { name: 'in review', color: '#ff8b00' },
      readyForQA: { name: 'ready for qa', color: '#9c1de9' },
      inTest: { name: 'in test', color: '#4b0082' },
      done: { name: 'done', color: '#43acd9' },
    },
    summary: '',
    withDailyDescription: '',
    withWeeklyDescription: '',
  })
})

it('can override jira fields', () => {
  mockConfig({
    jiraFields: `
      story-points: your friend
      ready-for-review-time: My Banana
    `,
  })

  const config = parseOptions()
  expect(config.jiraFields).toEqual({
    storyPoints: 'your friend',
    startTime: 'start time',
    readyForReviewTime: 'my banana',
    devCompleteTime: 'development complete time',
    endTime: 'resolutiondate',
  })
})

it('can override jira statuses', () => {
  mockConfig({
    jiraStatuses: `
      done: Complete
      in-progress: #f9f9f9
      ready-for-qa: Ready for Test #aaaaaa
    `,
  })

  const config = parseOptions()
  expect(config.statuses).toEqual({
    draft: { name: 'draft', color: '#8fa3bf' },
    blocked: { name: 'blocked', color: '#ff1493' },
    todo: { name: 'to do', color: '#f15a50' },
    inProgress: { name: 'in progress', color: '#f9f9f9' },
    inReview: { name: 'in review', color: '#ff8b00' },
    readyForQA: { name: 'ready for test', color: '#aaaaaa' },
    inTest: { name: 'in test', color: '#4b0082' },
    done: { name: 'complete', color: '#43acd9' },
  })
})

it('can override jql used to query issues', () => {
  const jql = 'fixVersion = "pump"'
  mockConfig({ jql })
  const config = parseOptions()
  expect(config.jql).toEqual(jql)
})
