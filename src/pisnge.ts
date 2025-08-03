import { exec, spawn } from 'node:child_process'
import { X_OK } from 'node:constants'
import { access, chmod, writeFile } from 'node:fs/promises'
import { arch, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const PISNGE_BINARY_URL_PREFIX =
  'https://github.com/insidewhy/pisnge/releases/latest/download/pisnge-'

async function isMuslLinux(): Promise<boolean> {
  try {
    // Method 1: Check if ldd is available and mentions musl
    const { stdout } = await execAsync('ldd --version 2>&1')
    if (stdout.includes('musl')) {
      return true
    }
  } catch {
    // ldd might not exist or fail
  }

  // Method 2: Check for Alpine Linux (most common musl distribution)
  try {
    await access('/etc/alpine-release')
    return true
  } catch {
    // File doesn't exist
  }

  // Method 3: Check if /lib/ld-musl* exists
  try {
    const { stdout } = await execAsync('ls /lib/ld-musl* 2>/dev/null')
    if (stdout.trim()) {
      return true
    }
  } catch {
    // No musl loader found
  }

  // Default to glibc
  return false
}

async function getBinarySuffix(): Promise<string> {
  const osPlatform = platform()
  const osArch = arch()

  if (osPlatform === 'linux') {
    return (await isMuslLinux()) ? 'linux-musl' : 'linux-glibc'
  } else if (osPlatform === 'darwin') {
    if (osArch === 'arm64') {
      return 'macos-arm64'
    } else {
      return 'macos-x64'
    }
  } else {
    throw new Error(`Unsupported platform: ${osPlatform}-${osArch}`)
  }
}

export class Pisnge {
  #downloadPromise?: Promise<void>
  readonly #binaryPath: string = join(tmpdir(), 'pisnge')

  beginDownload(): void {
    this.#downloadPromise ??= (async () => {
      try {
        await access(this.#binaryPath, X_OK)
      } catch {
        const binarySuffix = await getBinarySuffix()
        const downloadUrl = `${PISNGE_BINARY_URL_PREFIX}${binarySuffix}`
        const res = await fetch(downloadUrl)
        if (!res.ok || res.body === null) {
          throw new Error(`Failed to download pisnge binary from ${downloadUrl}: ${res.statusText}`)
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
