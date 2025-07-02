import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

import { Chart } from './charts'

export async function postChartsToChannel(
  slackToken: string,
  channel: string,
  charts: Chart[],
  initialComment: string | undefined,
) {
  const fileIds = await Promise.all(
    charts.map(async ({ filePath, mimeType }) => {
      const fileSize = (await stat(filePath)).size

      const getUploadUrlResponse = await fetch('https://slack.com/api/files.getUploadURLExternal', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${slackToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          length: fileSize.toString(),
          filename: basename(filePath),
        }).toString(),
      })
      if (!getUploadUrlResponse.ok) {
        throw new Error('Could not fetch upload url from slack')
      }

      const { upload_url: uploadUrl, file_id: fileId } = (await getUploadUrlResponse.json()) as {
        upload_url: string
        file_id: string
      }

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${slackToken}`,
          'Content-Type': mimeType,
        },
        body: new Blob([await readFile(filePath)], { type: mimeType }),
      })
      if (!uploadResponse.ok) {
        throw new Error('Could not upload file to slack upload url')
      }

      return fileId
    }),
  )

  const uploadBody: { channel_id: string; files: Array<{ id: string }>; initial_comment?: string } =
    {
      channel_id: channel,
      files: fileIds.map((fileId) => ({ id: fileId })),
    }
  if (initialComment) uploadBody.initial_comment = initialComment
  const completeUploadResponse = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${slackToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(uploadBody),
  })
  if (!completeUploadResponse.ok) {
    throw new Error('Could not complete slack file upload')
  }
  const response = (await completeUploadResponse.json()) as { ok?: string; error?: string }
  if (!response.ok) {
    throw new Error(response.error ?? 'Unknown error completing upload')
  }
}
