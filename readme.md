# action-jira-story-point-charts

A github action to generate story point charts from Jira issues and post them to a slack channel.

These are examples of what the charts posted may look like:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"pieStrokeColor":"white","pieOuterStrokeColor":"white","pieSectionTextColor":"white","pieOpacity":1,"pie1":"#43acd9","pie2":"#f15a50","pie3":"#038411","pie4":"#ff8b00","pie5":"#9c1de9"}}}%%
pie showData title Story points by status
  "Done": 133
  "To Do": 57
  "In Progress": 44
  "In Review": 10
  "Ready for QA": 9
```

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#038411,#9c1de9,#43acd9"}}}}%%
xychart-beta
  title "Story points remaining by week"
  x-axis ["Week 0", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6", "Week 7", "Week 8"]
  y-axis "Story points" 0 --> 253
  line [245, 228, 203, 180, 180, 160, 129, 81, 57]
  line [253, 242, 223, 190, 190, 173, 149, 127, 111]
  line [253, 244, 223, 190, 190, 174, 173, 155, 120]
```

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#038411,#9c1de9,#43acd9"}}}}%%
xychart-beta
  title "Story points remaining by day"
  x-axis ["Day 0", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"]
  y-axis "Story points" 57 --> 155
  line [81, 81, 81, 81, 81, 57, 57, 57]
  line [127, 127, 127, 127, 127, 112, 112, 111]
  line [155, 155, 155, 155, 153, 121, 121, 120]
```

- The blue lines/segments show the remaining story points that have not been completed (i.e. made it to `Done` status).
- The purple lines/segments show the remaining story points that have not been developed (i.e. made it to `In Review` or `Ready for QA` status).
- The green lines/segments show the remaining story points that have not been started (i.e. made it to `In Progress` status).

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#ff8b00, #9c1de9", "plotReservedSpacePercent": 0}}}}%%
xychart-beta
  title "Issues in review or ready for QA"
  x-axis [PJ-42, PJ-19, PJ-6, PJ-14, PJ-16]
  y-axis "Number of days in status" 0 --> 4
  bar [4, 3.5, 3, 1, 0]
  bar [1.5, 3, -1, 0.2, 0.5]
```

- The purple bars represent the number of days that issues have been ready for QA.
- The orange bars represent the number of days that issues have been in review.

## Installation

Add a step like this to a github action workflow e.g. a file at `.github/workflows/chart-bot.yml`:

```yaml
name: chart-bot

on:
  workflow_dispatch:
    inputs:
      slack-channel:
        description: Slack channel id

  # Run at 6.30pm SGT (10.30am UTC) Monday to Friday
  schedule:
    - cron: '30 10 * * 1-5'

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  chart-bot:
    runs-on: ubuntu-22.04

    steps:
      - uses: insidewhy/action-jira-story-point-charts@v0
        with:
          jira-token: ${{ secrets.JIRA_TOKEN }}
          jira-user: ${{ secrets.JIRA_USER }}
          jira-base-url: https://myjiraurl.atlassian.net
          slack-channel: ${{ github.event.inputs.slack-channel || 'C42PZTP3ECZ' }}
          slack-token: ${{ secrets.SLACK_TOKEN }}
          story-point-estimate: 5
```

- The `JIRA_TOKEN` github secret should be a personal Jira token.
- The `JIRA_USER` secret should be the email of the Jira user that created this token.
- The `story-point-estimate` is the story points to assign to any issue where the `Story Points` field is unset (`0` is not considered unset, the jira field must be null). If omitted then any issue with an unset story points field will be assumed to be worth 0 story points.
- The `SLACK_TOKEN` secret should be the `Bot User OAuth Token` of a slack app which must be created and installed in the slack workspace. This token must have `files:write` and `chat:write` permissions. The app bot must be invited to a channel to be able to post charts to it.

The slack channel ID must be given in `slack-channel` rather than the name of the channel, this can be retrieved by clicking on the channel name in slack.

This configuration shows how to trigger the workflow at specific times and manually, this manual trigger configuration allows the channel to be overridden.
To trigger the workflow manually using the configuration above `github-cli` could be used:

```bash
gh workflow run chart-bot -f slack-channel=C52ZZTO9EAA
```

### Extra configuration

#### charts

This determines which charts should be created and in which order they should be posted.
The following shows the defaults:

```yaml
charts: remaining-by-day by-status remaining-by-week in-review-and-test weekly-velocity
```

There are additional `velocity-by-developer` and `velocity-by-developer-this-week` charts available which are not produced by default.
These charts need `developer` and `dev-complete-time` field configurations.

#### jira-fields

The fields used to determine the `story points`, `start time`, and `development complete time` of an issue can be overriden by action inputs.
The following shows the defaults:

```yaml
jira-fields: |
  story-points: story points
  dev-complete-time: development complete time
  ready-for-review-time: ready for review time
  start-time: start time
  end-time: resolutiondate
  developer: developer
```

Field names in the config are matched to those in Jira using a case-insensitive comparison.

Note the `|` in the `yaml`, this is because github only supports string action fields so a "yaml like" string must be sent to the action.

The `resolutiondate` field is used to determine when an issue is completed, but the `Start Time`, `Ready For Review Time` and `Development Complete Time` fields are not available by default.
If the green, orange and purple lines would be appreciated then custom fields will need to be created, it is recommended to automatically update these fields when transitions occur, this can be configured by attaching actions to various workflow transitions in the Jira workflow configuration UI.

The `developer` field is only used by the `velocity-by-developer` and `velocity-by-developer-this-week` charts.

#### jira-statuses

The various status names and colors can be overridden by action inputs. The following shows the defaults:

```yaml
jira-statuses: |
  draft: draft #8fa3bf
  blocked: blocked #ff1493
  todo: to do #f15a50
  in-progress: in progress #038411
  in-review: in review #ff8b00
  ready-for-qa: ready for qa #9c1de9
  in-test: in test #4b0082
  done: done #43acd9
```

For each status, just the status name can be overridden, just the color can be overridden, or both the color and the status can be overridden:

```yaml
jira-statuses: |
  done: Complete
  in-progress: #f9f9f9
  ready-for-qa: Ready for Test #aaaaaa
```

Statuses in the config are matched to those in Jira using a case-insensitive comparison.

#### jql

By default the jql query for selecting issues is `fixVersion = earliestUnreleasedVersion()`.
This can be overridden using the `jql` input:

```yaml
jql: fixVersion = "release-1.0"
```

#### Summary

Optional summary text can also be attached to the slack message containing the charts:

```yaml
summary: These are the charts
```

#### Textual descriptions

A textual description containing the point changes for the week and/or day can be added to the slack message containing the charts.

```yaml
with-daily-description: Daily description heading
with-weekly-description: Weekly description heading
```

## Testing the action locally

There are unit tests:

```bash
pnpm test
```

Or an end-to-end test can be run by creating an environment file at `.env.test` such as:

```
INPUT_SLACK-CHANNEL=C0962KJPUPM
INPUT_STORY-POINT-ESTIMATE=5
INPUT_JIRA-USER=my@email.sg
INPUT_JIRA-BASE-URL=https://aproject.atlassian.net
INPUT_JIRA-TOKEN=my_jira_token_goes_here
INPUT_SLACK-TOKEN=my_slack_token_goes_here
```

Then run:

```
pnpm local-test
```

## Philosophy

Consider the following releases chart at week one, at this time there were 20 story points in the release on day 0 and 10 story points remaining at the end of the week:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#43acd9"}}}}%%
xychart-beta
  title "Story points remaining by week"
  x-axis ["Week 0", "Week 1"]
  y-axis "Story points" 0 --> 20
  line [20, 10]
```

During week two an additional 5 story points were added to the release and 5 story points were completed, now the chart looks like this:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#43acd9"}}}}%%
xychart-beta
  title "Story points remaining by week"
  x-axis ["Week 0", "Week 1", "Week 2"]
  y-axis "Story points" 0 --> 25
  line [25, 15, 10]
```

The chart considers that all story points that are currently in the release were there from day 0, while this misses data about how and when story points were added to a release, it allows the rate of progress to be accurately measured.
If the chart instead showed story points being added and removed the chart would look like this:

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {"xyChart":{"plotColorPalette":"#43acd9"}}}}%%
xychart-beta
  title "Story points remaining by week"
  x-axis ["Week 0", "Week 1", "Week 2"]
  y-axis "Story points" 0 --> 20
  line [20, 10, 10]
```

The 5 story points being added and the 5 story points completed during week two lead to a flat line, from the above chart it's impossible to know what occurred between the following two scenarios:

- The team completed no work
- The team did some work but an equal amount of work was added to the release.

Perfect information is rarely available from the beginning of a release.
It is hard for many teams to accurately track what work should be present in a sprint before it begins let alone an entire release, this often leads to sprint burn down charts that remain flat or increase over time.
By considering that the current story points in a release should always have been there, this can lead to more accurate tracking of progress towards completion.
Given that charts are being posted on a recurring basis into one or more slack channels, information about story points being added to a release can still be determined by comparing charts.
