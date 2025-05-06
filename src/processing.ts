import { JiraIssue } from './jira'

export interface PointBuckets {
  started: number[]
  hasStartedEvents: boolean

  developed: number[]
  hasDevelopedEvents: boolean

  toReview: number[]
  hasToReviewEvents: boolean

  done: number[]
  hasDoneEvents: boolean

  totalStoryPoints: number
  maxBucketIndex: number
}

export function makePointBuckets(
  issues: JiraIssue[],
  timePeriod: number,
  bucketCount?: number,
): PointBuckets | undefined {
  const events = new Map<
    number,
    { started: number; toReview: number; developed: number; done: number }
  >()
  let totalStoryPoints = 0
  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime,
    } = issue

    totalStoryPoints += storyPoints
    if (resolutionTime) {
      const time = resolutionTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.done += storyPoints
      } else {
        events.set(time, { done: storyPoints, started: 0, toReview: 0, developed: 0 })
      }
    }

    if (readyForReviewTime) {
      const time = readyForReviewTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.toReview += storyPoints
      } else {
        events.set(time, { toReview: storyPoints, done: 0, developed: 0, started: 0 })
      }
    }

    if (devCompleteTime) {
      const time = devCompleteTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.developed += storyPoints
      } else {
        events.set(time, { developed: storyPoints, done: 0, toReview: 0, started: 0 })
      }
    }

    if (startedTime) {
      const time = startedTime / timePeriod
      const event = events.get(time)
      if (event) {
        event.started += storyPoints
      } else {
        events.set(time, { started: storyPoints, developed: 0, toReview: 0, done: 0 })
      }
    }
  }

  if (events.size === 0) return undefined

  const sortedEvents = [...events.entries()]
    .map(([time, pointFields]) => ({ time, ...pointFields }))
    .sort((a, b) => a.time - b.time)

  const firstTime = sortedEvents[0].time
  // when a cut off factor is used then the chart should end at the current time and
  // buckets must all be aligned with the current time rather than the absolute first time
  const lastTime = bucketCount ? Date.now() / timePeriod : sortedEvents.at(-1)!.time
  const firstTimeRefPoint = bucketCount ? firstTime - (1 - ((lastTime - firstTime) % 1)) : firstTime

  const pointBuckets: PointBuckets = {
    started: [],
    hasStartedEvents: false,
    developed: [],
    hasDevelopedEvents: false,
    toReview: [],
    hasToReviewEvents: false,
    done: [],
    hasDoneEvents: false,
    totalStoryPoints,
    maxBucketIndex: Math.ceil(lastTime - firstTime),
  }

  for (const { time, started, toReview, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTimeRefPoint)
    if (started) {
      pointBuckets.started[relativeTime] = (pointBuckets.started[relativeTime] ?? 0) + started
    }
    if (toReview) {
      pointBuckets.toReview[relativeTime] = (pointBuckets.toReview[relativeTime] ?? 0) + toReview
    }
    if (developed) {
      pointBuckets.developed[relativeTime] = (pointBuckets.developed[relativeTime] ?? 0) + developed
    }
    if (done) {
      pointBuckets.done[relativeTime] = (pointBuckets.done[relativeTime] ?? 0) + done
    }
  }

  pointBuckets.hasStartedEvents = Boolean(pointBuckets.started.length)
  pointBuckets.hasToReviewEvents = Boolean(pointBuckets.toReview.length)
  pointBuckets.hasDevelopedEvents = Boolean(pointBuckets.developed.length)
  pointBuckets.hasDoneEvents = Boolean(pointBuckets.done.length)

  pointBuckets.started.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.toReview.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.developed.length = pointBuckets.maxBucketIndex + 1
  pointBuckets.done.length = pointBuckets.maxBucketIndex + 1

  for (let i = 0; i <= pointBuckets.maxBucketIndex; ++i) {
    const points = {
      started: pointBuckets.started[i] ?? 0,
      toReview: pointBuckets.toReview[i] ?? 0,
      developed: pointBuckets.developed[i] ?? 0,
      done: pointBuckets.done[i] ?? 0,
    }

    const prevDone = pointBuckets.done[i - 1] ?? 0
    pointBuckets.done[i] = prevDone + points.done

    const prevDeveloped = pointBuckets.developed[i - 1] ?? 0
    pointBuckets.developed[i] = Math.max(pointBuckets.done[i], prevDeveloped + points.developed)

    const prevToReview = pointBuckets.toReview[i - 1] ?? 0
    pointBuckets.toReview[i] = Math.max(pointBuckets.developed[i], prevToReview + points.toReview)

    const prevStarted = pointBuckets.started[i - 1] ?? 0
    pointBuckets.started[i] = Math.max(pointBuckets.toReview[i], prevStarted + points.started)
  }

  return pointBuckets
}

export interface PointBucketVelocities {
  started: number[]
  developed: number[]
  toReview: number[]
  done: number[]
}

export function makePointBucketVelocities(pointBuckets: PointBuckets): PointBucketVelocities {
  const velocities: PointBucketVelocities = {
    started: pointBuckets.hasStartedEvents ? [pointBuckets.started[0]] : [],
    toReview: pointBuckets.hasToReviewEvents ? [pointBuckets.toReview[0]] : [],
    developed: pointBuckets.hasDevelopedEvents ? [pointBuckets.developed[0]] : [],
    done: pointBuckets.hasDoneEvents ? [pointBuckets.done[0]] : [],
  }

  for (let i = 1; i <= pointBuckets.maxBucketIndex; ++i) {
    if (velocities.done.length) velocities.done[i] = pointBuckets.done[i] - pointBuckets.done[i - 1]
    if (velocities.developed.length)
      velocities.developed[i] = pointBuckets.developed[i] - pointBuckets.developed[i - 1]
    if (velocities.toReview.length)
      velocities.toReview[i] = pointBuckets.toReview[i] - pointBuckets.toReview[i - 1]
    if (velocities.started.length)
      velocities.started[i] = pointBuckets.started[i] - pointBuckets.started[i - 1]
  }

  return velocities
}
