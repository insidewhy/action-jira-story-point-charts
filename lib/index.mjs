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
async function makeStoryPointsPiChart(issues, options) {
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
async function makeRemainingStoryPointsLineChart(issues, options, timePeriod, label, cutOffFactor) {
  const events = /* @__PURE__ */ new Map();
  let totalStoryPoints = 0;
  for (const issue of issues) {
    const { storyPoints, resolutionTime, devCompleteTime, readyForReviewTime, startedTime } = issue;
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
  const pointEvents = {};
  const firstTime = sortedEvents[0].time;
  const lastTime = cutOffFactor ? Date.now() / timePeriod : sortedEvents.at(-1).time;
  const firstTimeRefPoint = cutOffFactor ? firstTime - (1 - (lastTime - firstTime) % 1) : firstTime;
  for (const { time, started, toReview, developed, done } of sortedEvents) {
    const relativeTime = Math.ceil(time - firstTimeRefPoint);
    if (started) {
      if (!pointEvents.started) pointEvents.started = [];
      pointEvents.started[relativeTime] = (pointEvents.started[relativeTime] ?? 0) + started;
    }
    if (toReview) {
      if (!pointEvents.toReview) pointEvents.toReview = [];
      pointEvents.toReview[relativeTime] = (pointEvents.toReview[relativeTime] ?? 0) + toReview;
    }
    if (developed) {
      if (!pointEvents.developed) pointEvents.developed = [];
      pointEvents.developed[relativeTime] = (pointEvents.developed[relativeTime] ?? 0) + developed;
    }
    if (done) {
      if (!pointEvents.done) pointEvents.done = [];
      pointEvents.done[relativeTime] = (pointEvents.done[relativeTime] ?? 0) + done;
    }
  }
  let maxBucketIndex = Math.ceil(lastTime - firstTime);
  if (pointEvents.started) pointEvents.started.length = maxBucketIndex + 1;
  if (pointEvents.toReview) pointEvents.toReview.length = maxBucketIndex + 1;
  if (pointEvents.developed) pointEvents.developed.length = maxBucketIndex + 1;
  if (pointEvents.done) pointEvents.done.length = maxBucketIndex + 1;
  const chartPoints = {
    started: [totalStoryPoints],
    toReview: [totalStoryPoints],
    developed: [totalStoryPoints],
    done: [totalStoryPoints]
  };
  for (let i = 0; i <= maxBucketIndex; ++i) {
    const points = {
      started: pointEvents.started?.[i] ?? 0,
      toReview: pointEvents.toReview?.[i] ?? 0,
      developed: pointEvents.developed?.[i] ?? 0,
      done: pointEvents.done?.[i] ?? 0
    };
    const prevDone = chartPoints.done[i - 1] ?? totalStoryPoints;
    chartPoints.done[i] = prevDone - points.done;
    const prevDeveloped = chartPoints.developed[i - 1] ?? totalStoryPoints;
    chartPoints.developed[i] = Math.min(chartPoints.done[i], prevDeveloped - points.developed);
    const prevToReview = chartPoints.toReview[i - 1] ?? totalStoryPoints;
    chartPoints.toReview[i] = Math.min(chartPoints.developed[i], prevToReview - points.toReview);
    const prevStarted = chartPoints.started[i - 1] ?? totalStoryPoints;
    chartPoints.started[i] = Math.min(chartPoints.toReview[i], prevStarted - points.started);
  }
  let minY = 0;
  let maxY = totalStoryPoints;
  if (cutOffFactor) {
    maxBucketIndex = cutOffFactor;
    const cutOffPoint = -cutOffFactor - 1;
    chartPoints.started = chartPoints.started?.slice(cutOffPoint);
    chartPoints.toReview = chartPoints.toReview?.slice(cutOffPoint);
    chartPoints.developed = chartPoints.developed?.slice(cutOffPoint);
    chartPoints.done = chartPoints.done?.slice(cutOffPoint);
    minY = Math.min(
      chartPoints.started?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      chartPoints.toReview?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      chartPoints.developed?.at(-1) ?? Number.MAX_SAFE_INTEGER,
      chartPoints.done?.at(-1) ?? Number.MAX_SAFE_INTEGER
    );
    maxY = Math.max(
      chartPoints.started?.[0] ?? 0,
      chartPoints.toReview?.[0] ?? 0,
      chartPoints.developed?.[0] ?? 0,
      chartPoints.done?.[0] ?? 0
    );
  }
  const { statuses } = options;
  const plotColorPalette = [];
  const lines = [];
  if (pointEvents.started) {
    plotColorPalette.push(statuses.inProgress.color);
    lines.push(`  line [${chartPoints.started.join(", ")}]`);
  }
  if (pointEvents.toReview) {
    plotColorPalette.push(statuses.inReview.color);
    lines.push(`  line [${chartPoints.toReview.join(", ")}]`);
  }
  if (pointEvents.developed) {
    plotColorPalette.push(statuses.readyForQA.color);
    lines.push(`  line [${chartPoints.developed.join(", ")}]`);
  }
  if (pointEvents.done) {
    plotColorPalette.push(statuses.done.color);
    lines.push(`  line [${chartPoints.done.join(", ")}]`);
  }
  const theme = { xyChart: { plotColorPalette: plotColorPalette.join(",") } };
  const ucFirstLabel = ucFirst(label);
  const xAxis = rangeTo(maxBucketIndex + 1).map((i) => `"${ucFirstLabel} ${i}"`).join(", ");
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
xychart-beta
  title "Story points remaining by ${label}"
  x-axis [${xAxis}]
  y-axis "Story points" ${minY} --> ${maxY}
` + lines.join("\n");
  return makeChartFiles(mmd, `remaining-storypoints-by-${label}`, options);
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
    xyChart: { plotColorPalette: `${statuses.inReview.color}, ${statuses.readyForQA.color}` }
  };
  const inReviewBar = sorted.map((stat2) => stat2.daysReadyForReview);
  const readyForQABar = sorted.map((stat2) => stat2.daysReadyForQA === 0 ? -1 : stat2.daysReadyForQA);
  const maxX = Math.max(sorted[0].daysReadyForReview, sorted[0].daysReadyForQA);
  const mmd = `%%{init: {'theme': 'base', 'themeVariables': ${JSON.stringify(theme)}}}%%
xychart-beta
  title "Issues in review or ready for QA"
  x-axis [${[...sorted.map(({ status }) => status)].join(", ")}]
  y-axis "Number of days in status" 0 --> ${maxX}
  bar [${inReviewBar.join(", ")}]
  bar [${readyForQABar.join(", ")}]`;
  return makeChartFiles(mmd, "open-issues", options);
}

// src/config.ts
import { getInput } from "@actions/core";
var OUTPUT_DIRECTORY = "charts";
var DEFAULT_STATUSES = {
  draft: { name: "draft", color: "#388bff" },
  todo: { name: "to do", color: "#f15a50" },
  inProgress: { name: "in progress", color: "#038411" },
  inReview: { name: "in review", color: "#ff8b00" },
  readyForQA: { name: "ready for qa", color: "#9c1de9" },
  done: { name: "done", color: "#43acd9" }
};
var DEFAULT_JIRA_FIELDS = {
  storyPoints: "story points",
  devCompleteTime: "development complete time",
  startTime: "start time",
  readyForReviewTime: "ready for review time"
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
  const storyPointEstimateRaw = getInput("story-point-estimate");
  const jiraUser = getInput("jira-user", { required: true });
  const jiraBaseUrl = getInput("jira-base-url", { required: true });
  const jiraToken = getInput("jira-token", { required: true });
  const slackToken = getInput("slack-token", { required: true });
  const jiraFieldsRaw = getInput("jira-fields");
  const jiraStatusesRaw = getInput("jira-statuses");
  const jql = getInput("jql") || DEFAULT_JQL;
  const jiraFields = { ...DEFAULT_JIRA_FIELDS };
  if (jiraFieldsRaw) {
    const fieldMap = {
      "story-points": "storyPoints",
      "start-time": "storyPoints",
      "dev-complete-time": "devCompleteTime",
      "ready-for-review-time": "readyForReviewTime"
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
      todo: "todo",
      "in-progress": "inProgress",
      "in-review": "inReview",
      "ready-for-qa": "readyForQA",
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
    output: OUTPUT_DIRECTORY,
    storyPointEstimate,
    statuses,
    jiraBaseUrl,
    jiraAuth: Buffer.from(`${jiraUser}:${jiraToken}`).toString("base64"),
    slackToken,
    jiraFields,
    jql
  };
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
async function getCustomFields(auth, baseUrl, fields) {
  const fieldMetadata = await makeJiraApiRequest(
    auth,
    baseUrl,
    "field"
  );
  let storyPoints = "";
  let devCompleteTime;
  let startTime;
  let readyForReviewTime;
  for (const field of fieldMetadata) {
    const fieldName = field.name.toLocaleLowerCase();
    if (fieldName === fields.storyPoints) storyPoints = field.id;
    else if (fieldName === fields.devCompleteTime) devCompleteTime = field.id;
    else if (fieldName === fields.startTime) startTime = field.id;
    else if (fieldName === fields.readyForReviewTime) readyForReviewTime = field.id;
  }
  if (!storyPoints) {
    throw new Error(`Could not find "${fields.storyPoints}" field`);
  }
  return { storyPoints, devCompleteTime, readyForReviewTime, startTime };
}
function fetchIssuesPage(auth, baseUrl, jql, offset = 0) {
  return makeJiraApiRequest(auth, baseUrl, `search?jql=${jql}&startAt=${offset}`);
}
async function fetchIssues(options) {
  const { jiraAuth: auth, jiraBaseUrl: baseUrl, jql: rawJql, statuses } = options;
  const jql = encodeURIComponent(rawJql);
  const fieldIds = await getCustomFields(auth, baseUrl, options.jiraFields);
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
    let resolutionTime;
    if (lcStatus === statuses.done.name) {
      const resolutionDate = issue.fields.resolutiondate;
      resolutionTime = resolutionDate ? new Date(resolutionDate).getTime() : void 0;
    }
    let devCompleteTime;
    if (fieldIds.devCompleteTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.readyForQA.name) {
        const devCompletedDate = issue.fields[fieldIds.devCompleteTime];
        devCompleteTime = devCompletedDate ? new Date(devCompletedDate).getTime() : void 0;
      }
    }
    let readyForReviewTime;
    if (fieldIds.readyForReviewTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.readyForQA.name || lcStatus === statuses.inReview.name) {
        const readyForReviewDate = issue.fields[fieldIds.readyForReviewTime];
        readyForReviewTime = readyForReviewDate ? new Date(readyForReviewDate).getTime() : void 0;
      }
    }
    let startedTime;
    if (fieldIds.startTime) {
      if (lcStatus === statuses.done.name || lcStatus === statuses.readyForQA.name || lcStatus === statuses.inReview.name || lcStatus === statuses.inProgress.name) {
        const startedDate = issue.fields[fieldIds.startTime];
        startedTime = startedDate ? new Date(startedDate).getTime() : void 0;
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
      startedTime
    });
  }
  return processedIssues;
}

// src/slack.ts
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
async function postChartToChannel(slackToken, channel, charts) {
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
  const completeUploadResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ channel_id: channel, files: fileIds.map((fileId) => ({ id: fileId })) })
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
async function runChartBot(options) {
  const issues = await fetchIssues(options);
  await mkdir(options.output, { recursive: true });
  const pieChart = await makeStoryPointsPiChart(issues, options);
  const byWeekChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    7 * 24 * 60 * 6e4,
    "week"
  );
  const byDayChart = await makeRemainingStoryPointsLineChart(
    issues,
    options,
    24 * 60 * 6e4,
    "day",
    7
  );
  const openIssuesChart = await makeOpenIssuesChart(issues, options);
  const { channel } = options;
  if (channel) {
    await postChartToChannel(
      options.slackToken,
      channel,
      [byDayChart, pieChart, byWeekChart, openIssuesChart].filter((chart) => chart !== void 0)
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
