// src/index.ts
import { mkdir } from "node:fs/promises";

// src/charts.ts
import { run as mermaidRun } from "@mermaid-js/mermaid-cli";
import { writeFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
var PIE_CHART_THEME = {
  pieStrokeColor: "white",
  pieOuterStrokeColor: "white",
  pieSectionTextColor: "white",
  pieOpacity: 1
};
async function makeChartFiles(mmd, fileNamePrefix, options) {
  const mmdPath = pathJoin(options.output, `${fileNamePrefix}.mmd`);
  await writeFile(mmdPath, mmd);
  if (options.noImages) {
    return { filePath: mmdPath, mimeType: "text/vnd.mermaid" };
  } else {
    const imagePath = pathJoin(options.output, `${fileNamePrefix}.png`);
    await mermaidRun(mmdPath, imagePath);
    return { filePath: imagePath, mimeType: "image/png" };
  }
}
function getPointsByStatus(issues) {
  const pointsByStatus = /* @__PURE__ */ new Map();
  for (const issue of issues) {
    const { status, storyPoints } = issue;
    pointsByStatus.set(status, (pointsByStatus.get(status) ?? 0) + storyPoints);
  }
  return pointsByStatus;
}
async function makeStoryPointsPieChart(issues, options) {
  const pointsByStatus = getPointsByStatus(issues);
  if (pointsByStatus.size === 0) return void 0;
  const pieChartEntries = [...pointsByStatus.entries()].reduce(
    (acc, [name, points]) => {
      const associatedStatus = Object.values(options.statuses).find(
        ({ name: statusName }) => statusName === name.toLocaleLowerCase()
      );
      acc.push({ name, color: associatedStatus?.color ?? void 0, points });
      return acc;
    },
    []
  );
  const theme = { ...PIE_CHART_THEME };
  for (const [idx, entry] of pieChartEntries.sort((a, b) => b.points - a.points).entries()) {
    if (entry.color) {
      theme[`pie${idx + 1}`] = entry.color;
    }
  }
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
pie showData title Story points by status
` + pieChartEntries.map((entry) => `  "${entry.name}": ${entry.points}
`).join("");
  return makeChartFiles(mmd, "storypoints-by-status-pie", options);
}
var rangeTo = (limit) => Array.from(new Array(limit), (_, i) => i);
var ucFirst = (str) => str[0].toLocaleUpperCase() + str.slice(1);
async function makeRemainingStoryPointsLineChart(pointBuckets, options, label, bucketCount) {
  const { totalStoryPoints } = pointBuckets;
  const remainingPoints = {
    started: [totalStoryPoints],
    toReview: [totalStoryPoints],
    developed: [totalStoryPoints],
    done: [totalStoryPoints]
  };
  for (let i = 0; i <= pointBuckets.maxBucketIndex; ++i) {
    remainingPoints.done[i] = totalStoryPoints - pointBuckets.done[i];
    remainingPoints.developed[i] = totalStoryPoints - pointBuckets.developed[i];
    remainingPoints.toReview[i] = totalStoryPoints - pointBuckets.toReview[i];
    remainingPoints.started[i] = totalStoryPoints - pointBuckets.started[i];
  }
  let minY = 0;
  let maxY = totalStoryPoints;
  if (bucketCount) {
    const cutOffPoint = -bucketCount - 1;
    remainingPoints.started = remainingPoints.started?.slice(cutOffPoint);
    remainingPoints.toReview = remainingPoints.toReview?.slice(cutOffPoint);
    remainingPoints.developed = remainingPoints.developed?.slice(cutOffPoint);
    remainingPoints.done = remainingPoints.done?.slice(cutOffPoint);
    minY = Math.min(
      remainingPoints.started?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.toReview?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.developed?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      remainingPoints.done?.at(-1) ?? Number.MAX_SAFE_INTEGER
    );
    maxY = Math.max(
      remainingPoints.started?.[0] ?? 0,
      remainingPoints.toReview?.[0] ?? 0,
      remainingPoints.developed?.[0] ?? 0,
      remainingPoints.done?.[0] ?? 0
    );
  }
  const { statuses } = options;
  const plotColorPalette = [];
  const lines = [];
  if (pointBuckets.hasStartedEvents) {
    plotColorPalette.push(statuses.inProgress.color);
    lines.push(`  line [${remainingPoints.started.join(", ")}]`);
  }
  if (pointBuckets.hasToReviewEvents) {
    plotColorPalette.push(statuses.inReview.color);
    lines.push(`  line [${remainingPoints.toReview.join(", ")}]`);
  }
  if (pointBuckets.hasDevelopedEvents) {
    plotColorPalette.push(statuses.readyForQA.color);
    lines.push(`  line [${remainingPoints.developed.join(", ")}]`);
  }
  if (pointBuckets.hasDoneEvents) {
    plotColorPalette.push(statuses.done.color);
    lines.push(`  line [${remainingPoints.done.join(", ")}]`);
  }
  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(",") } };
  const xAxisCount = (bucketCount ?? pointBuckets.maxBucketIndex) + 1;
  const shownLabel = xAxisCount >= 10 ? label[0].toUpperCase() : ucFirst(label);
  const xAxis = rangeTo(xAxisCount).map((i) => `"${shownLabel} ${i}"`).join(", ");
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
xychart-beta
  title "Story points remaining by ${label}"
  x-axis [${xAxis}]
  y-axis "Story points" ${minY} --> ${maxY}
` + lines.join("\n");
  return makeChartFiles(mmd, `remaining-storypoints-by-${label}`, options);
}
async function makeVelocityChart(velocities, options) {
  if (velocities.started.length <= 2) return void 0;
  const maxY = Math.max(
    ...velocities.done,
    ...velocities.developed,
    ...velocities.toReview,
    ...velocities.started
  );
  const { statuses } = options;
  const plotColorPalette = [];
  const lines = [];
  if (velocities.started.length) {
    plotColorPalette.push(statuses.inProgress.color);
    lines.push(`  line [${velocities.started.slice(1, -1).join(", ")}]`);
  }
  if (velocities.toReview.length) {
    plotColorPalette.push(statuses.inReview.color);
    lines.push(`  line [${velocities.toReview.slice(1, -1).join(", ")}]`);
  }
  if (velocities.developed.length) {
    plotColorPalette.push(statuses.readyForQA.color);
    lines.push(`  line [${velocities.developed.slice(1, -1).join(", ")}]`);
  }
  if (velocities.done.length) {
    plotColorPalette.push(statuses.done.color);
    lines.push(`  line [${velocities.done.slice(1, -1).join(", ")}]`);
  }
  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(",") } };
  const xAxisCount = velocities.started.length - 2;
  const shownLabel = xAxisCount >= 10 ? "W" : "Week";
  const xAxis = rangeTo(xAxisCount).map((i) => `"${shownLabel} ${i + 1}"`).join(", ");
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
xychart-beta
  title "Story point velocity by week"
  x-axis [${xAxis}]
  y-axis "Story points" 0 --> ${maxY}
` + lines.join("\n");
  return makeChartFiles(mmd, "storypoint-velocity-by-week", options);
}
async function makeOpenIssuesChart(issues, options) {
  const openIssues = /* @__PURE__ */ new Map();
  const millisecondsInADay = 24 * 60 * 6e4;
  const now = Date.now();
  const { statuses } = options;
  for (const issue of issues) {
    const lcStatus = issue.status.toLocaleLowerCase();
    if (!issue.devCompleteTime) continue;
    let daysReadyForQA = 0;
    let daysReadyForReview = 0;
    const readyForQA = lcStatus === statuses.readyForQA.name;
    if (readyForQA && issue.devCompleteTime) {
      daysReadyForQA = (now - issue.devCompleteTime) / millisecondsInADay;
    }
    if (issue.readyForReviewTime && (readyForQA || lcStatus === statuses.inReview.name)) {
      daysReadyForReview = (now - issue.readyForReviewTime) / millisecondsInADay;
    }
    if (daysReadyForReview >= daysReadyForQA) {
      daysReadyForReview = Math.max(0, daysReadyForReview - daysReadyForQA);
    }
    if (daysReadyForQA || daysReadyForReview) {
      openIssues.set(issue.key, { daysReadyForQA, daysReadyForReview });
    }
  }
  if (openIssues.size === 0) return void 0;
  const sorted = [...openIssues.entries()].map(([status, stat2]) => ({ status, ...stat2 })).sort((a, b) => b.daysReadyForQA - a.daysReadyForQA);
  const theme = {
    xyChart: {
      plotColorPalette: [
        statuses.inReview.color,
        statuses.readyForQA.color,
        statuses.inReview.color
      ].join(", ")
    }
  };
  const inReviewBar = sorted.map((stat2) => stat2.daysReadyForReview);
  const readyForQABar = sorted.map((stat2) => stat2.daysReadyForQA === 0 ? -1 : stat2.daysReadyForQA);
  const inReviewBarOnTop = sorted.map((stat2) => {
    return stat2.daysReadyForQA > stat2.daysReadyForReview ? stat2.daysReadyForReview : -1;
  });
  const maxX = Math.max(sorted[0].daysReadyForReview, sorted[0].daysReadyForQA);
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
xychart-beta
  title "Issues in review or ready for QA"
  x-axis [${[...sorted.map(({ status }) => status)].join(", ")}]
  y-axis "Number of days in status" 0 --> ${maxX}
  bar [${inReviewBar.join(", ")}]
  bar [${readyForQABar.join(", ")}]  bar [${inReviewBarOnTop.join(", ")}]`;
  return makeChartFiles(mmd, "open-issues", options);
}
async function makeAverageWeelyVelocityByDeveloperChart(issues, timePeriod, options) {
  const events = /* @__PURE__ */ new Map();
  let firstDevCompleteTime = Number.MAX_SAFE_INTEGER;
  for (const issue of issues) {
    const { devCompleteTime, developer, storyPoints } = issue;
    if (storyPoints && developer && devCompleteTime && devCompleteTime < firstDevCompleteTime) {
      firstDevCompleteTime = devCompleteTime;
    }
  }
  if (firstDevCompleteTime === Number.MAX_SAFE_INTEGER) return void 0;
  const startTimes = /* @__PURE__ */ new Map();
  for (const issue of issues) {
    const { storyPoints, developer } = issue;
    if (!storyPoints || !developer) continue;
    const { devCompleteTime, startedTime } = issue;
    if (startedTime) {
      const relativeTime = Math.max(
        Math.floor((startedTime - firstDevCompleteTime) / timePeriod),
        0
      );
      const previousStartTime = startTimes.get(developer);
      if (previousStartTime === void 0 || relativeTime < previousStartTime) {
        startTimes.set(developer, relativeTime);
      }
    }
    if (devCompleteTime) {
      const relativeTime = Math.floor((devCompleteTime - firstDevCompleteTime) / timePeriod);
      let timeBuckets = events.get(relativeTime);
      if (!timeBuckets) {
        timeBuckets = /* @__PURE__ */ new Map();
        events.set(relativeTime, timeBuckets);
      }
      timeBuckets.set(developer, (timeBuckets.get(developer) ?? 0) + storyPoints);
    }
  }
  if (events.size < 3) return void 0;
  const orderedKeys = Array.from(events.keys()).sort((a, b) => a - b);
  const keyLimit = orderedKeys.at(-1);
  const velocities = /* @__PURE__ */ new Map();
  for (let i = 1; i < keyLimit; ++i) {
    for (const [developer, storyPoints] of events.get(i)?.entries() ?? []) {
      const firstDevKey = startTimes.get(developer) ?? 0;
      if (i <= firstDevKey) continue;
      const nDevKeys = keyLimit - (firstDevKey + 1);
      velocities.set(developer, (velocities.get(developer) ?? 0) + storyPoints / nDevKeys);
    }
  }
  const mmd = `pie showData title Average weekly story point velocity
` + Array.from(velocities.entries()).map(([developer, points]) => `  "${developer}": ${points.toFixed(1)}
`).join("");
  return makeChartFiles(mmd, "average-weekly-storypoint-velocity-per-developer-pie", options);
}
async function makeVelocityByDeveloperChart(issues, timePeriod, options) {
  const velocities = /* @__PURE__ */ new Map();
  const weekStart = Date.now() - timePeriod;
  for (const issue of issues) {
    const { storyPoints, developer } = issue;
    if (!storyPoints || !developer) continue;
    const { devCompleteTime } = issue;
    if (devCompleteTime && devCompleteTime > weekStart) {
      velocities.set(developer, (velocities.get(developer) ?? 0) + storyPoints);
    }
  }
  const mmd = `pie showData title Story point velocity this week
` + Array.from(velocities.entries()).map(([developer, points]) => `  "${developer}": ${points}
`).join("");
  return makeChartFiles(mmd, "storypoint-velocity-per-developer-this-week-pie", options);
}

// src/config.ts
import { getInput } from "@actions/core";
var OUTPUT_DIRECTORY = "charts";
var DEFAULT_CHARTS = [
  "remaining-by-day",
  "by-status",
  "remaining-by-week",
  "in-review-and-test",
  "weekly-velocity"
];
var AVAILABLE_CHARTS = /* @__PURE__ */ new Set([
  ...DEFAULT_CHARTS,
  "velocity-by-developer",
  "velocity-by-developer-this-week"
]);
var DEFAULT_STATUSES = {
  draft: { name: "draft", color: "#8fa3bf" },
  blocked: { name: "blocked", color: "#ff1493" },
  todo: { name: "to do", color: "#f15a50" },
  inProgress: { name: "in progress", color: "#038411" },
  inReview: { name: "in review", color: "#ff8b00" },
  readyForQA: { name: "ready for qa", color: "#9c1de9" },
  inTest: { name: "in test", color: "#4b0082" },
  done: { name: "done", color: "#43acd9" }
};
var DEFAULT_JIRA_FIELDS = {
  storyPoints: "story points",
  devCompleteTime: "development complete time",
  startTime: "start time",
  readyForReviewTime: "ready for review time",
  endTime: "resolutiondate",
  developer: "developer"
};
var DEFAULT_JQL = "fixVersion = earliestUnreleasedVersion()";
var parseYamlLikeFields = (configName, configValue) => {
  const values = [];
  for (const rawLine of configValue.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const [name, rawValue] = line.split(/ *: */);
    const value = rawValue?.trim().toLocaleLowerCase();
    if (!name || !name) {
      throw new Error(`Invalid line in ${configName} configuration: "${line}"`);
    }
    values.push({ name, value, line });
  }
  return values;
};
function parseOptions() {
  const channel = getInput("slack-channel", { required: true });
  const chartsRaw = getInput("charts");
  const storyPointEstimateRaw = getInput("story-point-estimate");
  const jiraUser = getInput("jira-user", { required: true });
  const jiraBaseUrl = getInput("jira-base-url", { required: true });
  const jiraToken = getInput("jira-token", { required: true });
  const slackToken = getInput("slack-token", { required: true });
  const jiraFieldsRaw = getInput("jira-fields");
  const jiraStatusesRaw = getInput("jira-statuses");
  const jql = getInput("jql") || DEFAULT_JQL;
  const summary = getInput("summary");
  const withDailyDescription = getInput("with-daily-description");
  const withWeeklyDescription = getInput("with-weekly-description");
  let charts = DEFAULT_CHARTS;
  if (!/^\s*$/.test(chartsRaw)) {
    charts = chartsRaw.split(/\s+/);
    for (const chart of charts) {
      if (!AVAILABLE_CHARTS.has(chart)) throw new Error(`Chart type ${chart} is not supported`);
    }
  }
  const jiraFields = { ...DEFAULT_JIRA_FIELDS };
  if (jiraFieldsRaw) {
    const fieldMap = {
      "story-points": "storyPoints",
      "start-time": "storyPoints",
      "ready-for-review-time": "readyForReviewTime",
      "dev-complete-time": "devCompleteTime",
      "end-time": "endTime",
      developer: "developer"
    };
    for (const { name, value, line } of parseYamlLikeFields("jira-fields", jiraFieldsRaw)) {
      const configName = fieldMap[name];
      if (!configName) {
        throw new Error(`Unsupported field name "${name}" in jira-fields configuration: "${line}"`);
      }
      jiraFields[configName] = value;
    }
  }
  const statuses = jiraStatusesRaw ? Object.fromEntries(
    Object.entries(DEFAULT_STATUSES).map(([name, value]) => [name, { ...value }])
  ) : DEFAULT_STATUSES;
  if (jiraStatusesRaw) {
    const statusMap = {
      draft: "draft",
      blocked: "blocked",
      todo: "todo",
      "in-progress": "inProgress",
      "in-review": "inReview",
      "ready-for-qa": "readyForQA",
      "in-test": "inTest",
      done: "done"
    };
    for (const { name, value, line } of parseYamlLikeFields("jira-statuses", jiraStatusesRaw)) {
      const configName = statusMap[name];
      if (!configName) {
        throw new Error(`Unsupported status name "${name}" in jira-fields configuration: "${line}"`);
      }
      const status = statuses[configName];
      if (value.startsWith("#")) {
        status.color = value;
      } else {
        const colorIndex = value.lastIndexOf("#");
        if (colorIndex === -1) {
          status.name = value.toLocaleLowerCase();
        } else {
          status.color = value.slice(colorIndex).trim();
          status.name = value.slice(0, colorIndex).trim().toLocaleLowerCase();
        }
      }
    }
  }
  const storyPointEstimate = storyPointEstimateRaw ? parseInt(storyPointEstimateRaw) : 0;
  return {
    channel,
    charts,
    output: OUTPUT_DIRECTORY,
    storyPointEstimate,
    statuses,
    jiraBaseUrl,
    jiraAuth: Buffer.from(`${jiraUser}:${jiraToken}`).toString("base64"),
    slackToken,
    jiraFields,
    jql,
    summary,
    withDailyDescription,
    withWeeklyDescription
  };
}

// src/description.ts
var longestHeadingLength = "Not Yet Ready for QA".length + 2;
var percentage = (count, total, pad) => Math.round(total / count * 100).toString().padStart(pad, " ") + "%";
function meanOfVelocities(values) {
  const sum = values.slice(1, -1).reduce((acc, next) => acc + next);
  return (sum / (values.length - 2)).toFixed(1);
}
var numberOfDigits = (value) => Math.floor(Math.log10(value)) + 1;
function buildMetrics(totalStoryPoints, metrics) {
  const maxMetricLength = Math.max(
    ...metrics.flatMap(({ start, end }) => [
      numberOfDigits(totalStoryPoints - start),
      numberOfDigits(totalStoryPoints - end)
    ])
  );
  const percentagePad = metrics[0].start === totalStoryPoints ? 3 : 2;
  const diffPad = Math.max(...metrics.map(({ start, end }) => numberOfDigits(end - start))) + 1;
  const diffPercentagePad = Math.max(
    ...metrics.map(({ start, end }) => numberOfDigits((end - start) / totalStoryPoints * 100))
  ) + 1;
  return metrics.map(({ label, start, end, velocities }) => {
    const startRemaining = totalStoryPoints - start;
    const endRemaining = totalStoryPoints - end;
    let lineContent = (label + ":").padEnd(longestHeadingLength, " ") + " " + startRemaining.toString().padStart(maxMetricLength, " ") + " [" + percentage(totalStoryPoints, startRemaining, percentagePad) + "] -> " + endRemaining.toString().padStart(maxMetricLength, " ") + "[" + percentage(totalStoryPoints, endRemaining, percentagePad) + "] (" + (start - end).toString().padStart(diffPad, " ") + " [" + percentage(totalStoryPoints, start - end, diffPercentagePad) + "])";
    if (velocities?.length && velocities.length > 2) {
      lineContent += ` - Mean Velocity: ${meanOfVelocities(velocities)}`;
    }
    return `> \`${lineContent}\``;
  }).join("\n");
}
function describeChanges(header, issues, timePeriod, velocities) {
  const periodStart = Date.now() - timePeriod;
  let totalStoryPoints = 0;
  const start = { started: 0, toReview: 0, developed: 0, done: 0 };
  const end = { started: 0, toReview: 0, developed: 0, done: 0 };
  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime
    } = issue;
    totalStoryPoints += storyPoints;
    if (startedTime) {
      end.started += storyPoints;
      if (startedTime < periodStart) {
        start.started += storyPoints;
      }
    }
    if (readyForReviewTime) {
      end.toReview += storyPoints;
      if (readyForReviewTime < periodStart) {
        start.toReview += storyPoints;
      }
    }
    if (devCompleteTime) {
      end.developed += storyPoints;
      if (devCompleteTime < periodStart) {
        start.developed += storyPoints;
      }
    }
    if (resolutionTime) {
      end.done += storyPoints;
      if (resolutionTime < periodStart) {
        start.done += storyPoints;
      }
    }
  }
  return `> ${header}
` + buildMetrics(totalStoryPoints, [
    { label: "To Do", start: start.started, end: end.started, velocities: velocities?.started },
    {
      label: "Not Yet In Review",
      start: start.toReview,
      end: end.toReview,
      velocities: velocities?.toReview
    },
    {
      label: "Not Yet Ready for QA",
      start: start.developed,
      end: end.developed,
      velocities: velocities?.developed
    },
    { label: "Unfinished", start: start.done, end: end.done, velocities: velocities?.done }
  ]);
}

// src/jira.ts
async function makeJiraApiRequest(auth, baseUrl, path) {
  const response = await fetch(`${baseUrl}/rest/api/3/${path}`, {
    headers: { authorization: `Basic ${auth}` }
  });
  if (!response.ok) {
    throw new Error("Could not contact jira");
  }
  return response.json();
}
async function getFieldIds(auth, baseUrl, fields) {
  const fieldMetadata = await makeJiraApiRequest(
    auth,
    baseUrl,
    "field"
  );
  let storyPoints = "";
  let startTime;
  let readyForReviewTime;
  let devCompleteTime;
  let endTime;
  let developer;
  for (const field of fieldMetadata) {
    const fieldName = field.name.toLocaleLowerCase();
    if (fieldName === fields.storyPoints) storyPoints = field.id;
    else if (fieldName === fields.devCompleteTime) devCompleteTime = field.id;
    else if (fieldName === fields.startTime) startTime = field.id;
    else if (fieldName === fields.readyForReviewTime) readyForReviewTime = field.id;
    else if (fieldName === fields.endTime) endTime = field.id;
    else if (fieldName === fields.developer) developer = field.id;
  }
  if (!storyPoints) {
    throw new Error(`Could not find "${fields.storyPoints}" field`);
  }
  if (!endTime) {
    if (fields.endTime === "resolutiondate") {
      endTime = "resolutiondate";
    } else {
      throw new Error(`Could not find "${fields.endTime}" field`);
    }
  }
  return { storyPoints, startTime, readyForReviewTime, devCompleteTime, endTime, developer };
}
function fetchIssuesPage(auth, baseUrl, jql, offset = 0) {
  return makeJiraApiRequest(auth, baseUrl, `search?jql=${jql}&startAt=${offset}`);
}
async function fetchIssues(options) {
  const { jiraAuth: auth, jiraBaseUrl: baseUrl, jql: rawJql, statuses } = options;
  const jql = encodeURIComponent(rawJql);
  const fieldIds = await getFieldIds(auth, baseUrl, options.jiraFields);
  const firstPage = await fetchIssuesPage(auth, baseUrl, jql);
  const { issues } = firstPage;
  const total = firstPage.total;
  while (issues.length < total) {
    const nextPage = await fetchIssuesPage(auth, baseUrl, jql, issues.length);
    issues.push(...nextPage.issues);
  }
  const processedIssues = [];
  for (const issue of issues) {
    const type = issue.fields.issuetype.name;
    if (type === "Epic") continue;
    const storyPoints = issue.fields[fieldIds.storyPoints] ?? options.storyPointEstimate;
    if (storyPoints === 0) continue;
    const status = issue.fields.status.name;
    const lcStatus = status.toLocaleLowerCase();
    const developer = fieldIds.developer ? issue.fields[fieldIds.developer]?.displayName : void 0;
    let endTime;
    if (lcStatus === statuses.done.name) {
      const endTimeString = issue.fields[fieldIds.endTime];
      endTime = endTimeString ? new Date(endTimeString).getTime() : void 0;
    }
    let devCompleteTime;
    if (fieldIds.devCompleteTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.inTest.name || lcStatus === statuses.readyForQA.name) {
        const devCompletedTimeString = issue.fields[fieldIds.devCompleteTime];
        devCompleteTime = devCompletedTimeString ? new Date(devCompletedTimeString).getTime() : void 0;
      }
    }
    let readyForReviewTime;
    if (fieldIds.readyForReviewTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.inTest.name || lcStatus === statuses.readyForQA.name || lcStatus === statuses.inReview.name) {
        const readyForReviewTimeString = issue.fields[fieldIds.readyForReviewTime];
        readyForReviewTime = readyForReviewTimeString ? new Date(readyForReviewTimeString).getTime() : void 0;
      }
    }
    let startedTime;
    if (fieldIds.startTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.inTest.name || lcStatus === statuses.readyForQA.name || lcStatus === statuses.inReview.name || lcStatus === statuses.inProgress.name) {
        const startedTimeString = issue.fields[fieldIds.startTime];
        startedTime = startedTimeString ? new Date(startedTimeString).getTime() : void 0;
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
      developer
    });
  }
  return processedIssues;
}

// src/processing.ts
function makePointBuckets(issues, timePeriod, bucketCount) {
  const events = /* @__PURE__ */ new Map();
  let totalStoryPoints = 0;
  for (const issue of issues) {
    const {
      storyPoints,
      endTime: resolutionTime,
      devCompleteTime,
      readyForReviewTime,
      startedTime
    } = issue;
    totalStoryPoints += storyPoints;
    if (resolutionTime) {
      const time = resolutionTime / timePeriod;
      const event = events.get(time);
      if (event) {
        event.done += storyPoints;
      } else {
        events.set(time, { done: storyPoints, started: 0, toReview: 0, developed: 0 });
      }
    }
    if (readyForReviewTime) {
      const time = readyForReviewTime / timePeriod;
      const event = events.get(time);
      if (event) {
        event.toReview += storyPoints;
      } else {
        events.set(time, { toReview: storyPoints, done: 0, developed: 0, started: 0 });
      }
    }
    if (devCompleteTime) {
      const time = devCompleteTime / timePeriod;
      const event = events.get(time);
      if (event) {
        event.developed += storyPoints;
      } else {
        events.set(time, { developed: storyPoints, done: 0, toReview: 0, started: 0 });
      }
    }
    if (startedTime) {
      const time = startedTime / timePeriod;
      const event = events.get(time);
      if (event) {
        event.started += storyPoints;
      } else {
        events.set(time, { started: storyPoints, developed: 0, toReview: 0, done: 0 });
      }
    }
  }
  if (events.size === 0) return void 0;
  const sortedEvents = [...events.entries()].map(([time, pointFields]) => ({ time, ...pointFields })).sort((a, b) => a.time - b.time);
  const firstTime = sortedEvents[0].time;
  const lastTime = bucketCount ? Date.now() / timePeriod : sortedEvents.at(-1).time;
  const firstTimeRefPoint = bucketCount ? firstTime - (1 - (lastTime - firstTime) % 1) : firstTime;
  const pointBuckets = {
    started: [],
    hasStartedEvents: false,
    developed: [],
    hasDevelopedEvents: false,
    toReview: [],
    hasToReviewEvents: false,
    done: [],
    hasDoneEvents: false,
    totalStoryPoints,
    maxBucketIndex: Math.ceil(lastTime - firstTime)
  };
  for (const { time, started, toReview, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTimeRefPoint);
    if (started) {
      pointBuckets.started[relativeTime] = (pointBuckets.started[relativeTime] ?? 0) + started;
    }
    if (toReview) {
      pointBuckets.toReview[relativeTime] = (pointBuckets.toReview[relativeTime] ?? 0) + toReview;
    }
    if (developed) {
      pointBuckets.developed[relativeTime] = (pointBuckets.developed[relativeTime] ?? 0) + developed;
    }
    if (done) {
      pointBuckets.done[relativeTime] = (pointBuckets.done[relativeTime] ?? 0) + done;
    }
  }
  pointBuckets.hasStartedEvents = Boolean(pointBuckets.started.length);
  pointBuckets.hasToReviewEvents = Boolean(pointBuckets.toReview.length);
  pointBuckets.hasDevelopedEvents = Boolean(pointBuckets.developed.length);
  pointBuckets.hasDoneEvents = Boolean(pointBuckets.done.length);
  pointBuckets.started.length = pointBuckets.maxBucketIndex + 1;
  pointBuckets.toReview.length = pointBuckets.maxBucketIndex + 1;
  pointBuckets.developed.length = pointBuckets.maxBucketIndex + 1;
  pointBuckets.done.length = pointBuckets.maxBucketIndex + 1;
  for (let i = 0; i <= pointBuckets.maxBucketIndex; ++i) {
    const points = {
      started: pointBuckets.started[i] ?? 0,
      toReview: pointBuckets.toReview[i] ?? 0,
      developed: pointBuckets.developed[i] ?? 0,
      done: pointBuckets.done[i] ?? 0
    };
    const prevDone = pointBuckets.done[i - 1] ?? 0;
    pointBuckets.done[i] = prevDone + points.done;
    const prevDeveloped = pointBuckets.developed[i - 1] ?? 0;
    pointBuckets.developed[i] = Math.max(pointBuckets.done[i], prevDeveloped + points.developed);
    const prevToReview = pointBuckets.toReview[i - 1] ?? 0;
    pointBuckets.toReview[i] = Math.max(pointBuckets.developed[i], prevToReview + points.toReview);
    const prevStarted = pointBuckets.started[i - 1] ?? 0;
    pointBuckets.started[i] = Math.max(pointBuckets.toReview[i], prevStarted + points.started);
  }
  return pointBuckets;
}
function makePointBucketVelocities(pointBuckets) {
  const velocities = {
    started: pointBuckets.hasStartedEvents ? [pointBuckets.started[0]] : [],
    toReview: pointBuckets.hasToReviewEvents ? [pointBuckets.toReview[0]] : [],
    developed: pointBuckets.hasDevelopedEvents ? [pointBuckets.developed[0]] : [],
    done: pointBuckets.hasDoneEvents ? [pointBuckets.done[0]] : []
  };
  for (let i = 1; i <= pointBuckets.maxBucketIndex; ++i) {
    if (velocities.done.length) velocities.done[i] = pointBuckets.done[i] - pointBuckets.done[i - 1];
    if (velocities.developed.length)
      velocities.developed[i] = pointBuckets.developed[i] - pointBuckets.developed[i - 1];
    if (velocities.toReview.length)
      velocities.toReview[i] = pointBuckets.toReview[i] - pointBuckets.toReview[i - 1];
    if (velocities.started.length)
      velocities.started[i] = pointBuckets.started[i] - pointBuckets.started[i - 1];
  }
  return velocities;
}

// src/slack.ts
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
async function postChartToChannel(slackToken, channel, charts, initialComment) {
  const fileIds = await Promise.all(
    charts.map(async ({ filePath, mimeType }) => {
      const fileSize = (await stat(filePath)).size;
      const getUploadUrlResponse = await fetch("https://slack.com/api/files.getUploadURLExternal", {
        method: "POST",
        headers: {
          authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          length: fileSize.toString(),
          filename: basename(filePath)
        }).toString()
      });
      if (!getUploadUrlResponse.ok) {
        throw new Error("Could not fetch upload url from slack");
      }
      const { upload_url: uploadUrl, file_id: fileId } = await getUploadUrlResponse.json();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${slackToken}`,
          "Content-Type": mimeType
        },
        body: new Blob([await readFile(filePath)], { type: mimeType })
      });
      if (!uploadResponse.ok) {
        throw new Error("Could not upload file to slack upload url");
      }
      return fileId;
    })
  );
  const uploadBody = {
    channel_id: channel,
    files: fileIds.map((fileId) => ({ id: fileId }))
  };
  if (initialComment) uploadBody.initial_comment = initialComment;
  const completeUploadResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(uploadBody)
  });
  if (!completeUploadResponse.ok) {
    throw new Error("Could not complete slack file upload");
  }
  const response = await completeUploadResponse.json();
  if (!response.ok) {
    throw new Error(response.error ?? "Unknown error completing upload");
  }
}

// src/index.ts
var DAY_IN_MSECS = 24 * 60 * 6e4;
var WEEK_IN_MSECS = 7 * DAY_IN_MSECS;
function once(callback) {
  let hasResult = false;
  let result;
  return () => {
    if (hasResult) return result;
    result = callback();
    hasResult = true;
    return result;
  };
}
async function runChartBot(options) {
  const issues = await fetchIssues(options);
  await mkdir(options.output, { recursive: true });
  const getWeeklyPointBuckets = once(() => makePointBuckets(issues, WEEK_IN_MSECS));
  const getWeeklyVelocities = once(() => {
    const weeklyBuckets = getWeeklyPointBuckets();
    return weeklyBuckets ? makePointBucketVelocities(weeklyBuckets) : void 0;
  });
  const getDailyPointBuckets = once(() => makePointBuckets(issues, DAY_IN_MSECS, 7));
  const allCharts = /* @__PURE__ */ new Map([
    [
      "remaining-by-day",
      async () => {
        const dailyPointBuckets = getDailyPointBuckets();
        return dailyPointBuckets ? await makeRemainingStoryPointsLineChart(dailyPointBuckets, options, "day", 7) : void 0;
      }
    ],
    ["by-status", () => makeStoryPointsPieChart(issues, options)],
    [
      "remaining-by-week",
      async () => {
        const weeklyPointBuckets = getWeeklyPointBuckets();
        return weeklyPointBuckets ? makeRemainingStoryPointsLineChart(weeklyPointBuckets, options, "week") : void 0;
      }
    ],
    ["in-review-and-test", () => makeOpenIssuesChart(issues, options)],
    [
      "weekly-velocity",
      async () => {
        const weeklyVelocities = getWeeklyVelocities();
        return weeklyVelocities ? makeVelocityChart(weeklyVelocities, options) : void 0;
      }
    ],
    [
      "velocity-by-developer",
      async () => makeAverageWeelyVelocityByDeveloperChart(issues, WEEK_IN_MSECS, options)
    ],
    [
      "velocity-by-developer-this-week",
      async () => makeVelocityByDeveloperChart(issues, WEEK_IN_MSECS, options)
    ]
  ]);
  const { channel } = options;
  const charts = await Promise.all(options.charts.map((chartName) => allCharts.get(chartName)()));
  const initialCommentSections = [
    options.summary,
    options.withDailyDescription && describeChanges(options.withDailyDescription, issues, DAY_IN_MSECS),
    options.withWeeklyDescription && describeChanges(options.withWeeklyDescription, issues, WEEK_IN_MSECS, getWeeklyVelocities())
  ].filter((v) => Boolean(v));
  if (channel) {
    await postChartToChannel(
      options.slackToken,
      channel,
      charts.filter((chart) => chart !== void 0),
      initialCommentSections.length ? initialCommentSections.join("\n") : void 0
    );
  }
}
async function run() {
  const options = parseOptions();
  await runChartBot(options);
}
if (process.env.GITHUB_ACTIONS) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
export {
  run
};
