import * as fs from 'fs'
import * as path from 'path'

const LOG_FILE = path.join(__dirname, '..', 'debug.log')
const MAX_LOG_SIZE = 512 * 1024
const FLUSH_INTERVAL = 2000

let logEnabled = true
let buffer: string[] = []
let flushTimer: any = null

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_FILE)
    if (stat.size > MAX_LOG_SIZE) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8')
      fs.writeFileSync(LOG_FILE, content.slice(-MAX_LOG_SIZE / 2))
    }
  } catch {
    try { fs.writeFileSync(LOG_FILE, '') } catch { logEnabled = false }
  }
}

function flush(): void {
  if (buffer.length === 0) return
  const data = buffer.join('')
  buffer = []
  fs.writeFile(LOG_FILE, data, { flag: 'a' }, () => {})
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL)
}

rotateIfNeeded()

export function log(msg: string): void {
  if (!logEnabled) return
  buffer.push(`[${new Date().toISOString()}] ${msg}\n`)
  scheduleFlush()
}

export function logError(context: string, err: any): void {
  log(`ERROR [${context}]: ${err?.message || err}`)
}
