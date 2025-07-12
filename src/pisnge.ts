import { spawn } from 'node:child_process'
import { X_OK } from 'node:constants'
import { access, chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PISNGE_BINARY_URL =
  'https://github.com/insidewhy/pisnge/releases/latest/download/pisnge-ubuntu-22.04'

export class Pisnge {
  #downloadPromise?: Promise<void>
  readonly #binaryPath: string = join(tmpdir(), 'pisnge')

  beginDownload(): void {
    this.#downloadPromise ??= (async () => {
      try {
        await access(this.#binaryPath, X_OK)
      } catch {
        const res = await fetch(PISNGE_BINARY_URL)
        if (!res.ok || res.body === null) {
          throw new Error(`Failed to download pisnge binary: ${res.statusText}`)
        }
        const buffer = await res.arrayBuffer()
        await writeFile(this.#binaryPath, Buffer.from(buffer))
        await chmod(this.#binaryPath, 0o755)
      }
    })()
  }

  private async waitForDownload(): Promise<void> {
    if (!this.#downloadPromise) {
      throw new Error('Must call beginDownload before waitForDownload')
    }
    await this.#downloadPromise
  }

  async run(args: string[]): Promise<void> {
    await this.waitForDownload()

    return new Promise((resolve, reject) => {
      const pisngeProcess = spawn(this.#binaryPath, args, { stdio: 'pipe' })
      let errorOutput = ''

      pisngeProcess.stderr.on('data', (data) => (errorOutput += data))

      pisngeProcess.on('error', (err) => {
        reject(new Error(`Failed to start pisnge process: ${err.message}`))
      })

      pisngeProcess.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`pisnge process exited with code ${code}: ${errorOutput}`))
        }
      })
    })
  }
}
