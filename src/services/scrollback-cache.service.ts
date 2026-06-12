import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as path from 'path'
import { log, logError } from '../utils/logger'

const BASE_CACHE_DIR = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'tabby-agent-mux', 'scrollback')
const INSTANCE_ID = process.pid.toString(36)
const CACHE_DIR = path.join(BASE_CACHE_DIR, INSTANCE_ID)
const MAX_LINES = 2000
const FLUSH_INTERVAL = 3000
const MAX_AGE_MS = 4 * 60 * 60 * 1000

interface CacheEntry {
  lines: string[]
  dirty: boolean
  filePath: string
  flushTimer: any
  flushing: boolean
  version: number
}

@Injectable({ providedIn: 'root' })
export class ScrollbackCacheService {
  private caches = new Map<string, CacheEntry>()
  private ready = false

  constructor() {
    setTimeout(() => {
      this.ensureDir()
      this.pruneOld()
      this.ready = true
    }, 1000)
  }

  private ensureDir(): void {
    try {
      fs.mkdir(CACHE_DIR, { recursive: true }, () => {})
    } catch {}
  }

  private sessionKey(sessionId: string, kind: string, cwd: string): string {
    const safeSessionId = sessionId.replace(/[^a-z0-9-]/gi, '_')
    const safeKind = kind.replace(/[^a-z0-9-]/gi, '_')
    const safeCwd = cwd.replace(/[\\/:*?"<>|]/g, '_').slice(-80)
    return `${safeSessionId}_${safeKind}_${safeCwd}`
  }

  private legacySessionKey(kind: string, cwd: string): string {
    const safe = cwd.replace(/[\\/:*?"<>|]/g, '_').slice(-80)
    return `${kind}_${safe}`
  }

  private filePath(key: string): string {
    return path.join(CACHE_DIR, key + '.scrollback')
  }

  append(sessionId: string, kind: string, cwd: string, data: string): void {
    const key = this.sessionKey(sessionId, kind, cwd)
    let entry = this.caches.get(key)

    if (!entry) {
      entry = {
        lines: [],
        dirty: false,
        filePath: this.filePath(key),
        flushTimer: null,
        flushing: false,
        version: 0,
      }
      this.caches.set(key, entry)
    }

    const newLines = data.split('\n')
    entry.lines.push(...newLines)
    if (entry.lines.length > MAX_LINES) {
      entry.lines = entry.lines.slice(-MAX_LINES)
    }
    entry.version++
    entry.dirty = true

    this.scheduleFlush(key, FLUSH_INTERVAL)
  }

  flushAll(): void {
    for (const key of this.caches.keys()) {
      this.flushEntry(key)
    }
  }

  private scheduleFlush(key: string, delayMs: number): void {
    const entry = this.caches.get(key)
    if (!entry || entry.flushTimer) return
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = null
      this.flushEntry(key)
    }, delayMs)
  }

  private flushEntry(key: string): void {
    const entry = this.caches.get(key)
    if (!entry || !entry.dirty || entry.flushing) return

    try {
      entry.flushing = true
      const targetVersion = entry.version
      const content = entry.lines.join('\n')
      fs.writeFile(entry.filePath, content, 'utf-8', (err) => {
        const current = this.caches.get(key)
        if (current !== entry) return
        entry.flushing = false
        if (err) {
          entry.dirty = true
          this.scheduleFlush(key, 1000)
          logError('ScrollbackCache.flush', err)
          return
        }
        if (entry.version === targetVersion) {
          entry.dirty = false
          return
        }
        entry.dirty = true
        this.scheduleFlush(key, 100)
      })
    } catch (e: any) {
      entry.flushing = false
      entry.dirty = true
      this.scheduleFlush(key, 1000)
      logError('ScrollbackCache.flush', e)
    }
  }

  recover(sessionId: string, kind: string, cwd: string): string | null {
    const filenames = [
      this.sessionKey(sessionId, kind, cwd) + '.scrollback',
      this.legacySessionKey(kind, cwd) + '.scrollback',
    ]

    try {
      if (!fs.existsSync(BASE_CACHE_DIR)) return null
      const dirs = fs.readdirSync(BASE_CACHE_DIR)
      for (const dir of dirs) {
        for (const filename of filenames) {
          const fp = path.join(BASE_CACHE_DIR, dir, filename)
          try {
            if (fs.existsSync(fp)) {
              const claimPath = `${fp}.claim.${process.pid.toString(36)}.${Date.now().toString(36)}`
              try {
                fs.renameSync(fp, claimPath)
              } catch {
                // Another instance may have claimed this file.
                continue
              }
              const content = fs.readFileSync(claimPath, 'utf-8')
              if (content.length > 0) {
                log(`ScrollbackCache: recovered ${content.split('\n').length} lines for ${kind}@${cwd}`)
                fs.unlink(claimPath, () => {})
                return content
              }
              fs.unlink(claimPath, () => {})
            }
          } catch {}
        }
      }
    } catch {}
    return null
  }

  remove(sessionId: string, kind: string, cwd: string): void {
    const keys = [
      this.sessionKey(sessionId, kind, cwd),
      this.legacySessionKey(kind, cwd),
    ]

    for (const key of keys) {
      const entry = this.caches.get(key)
      if (entry) {
        if (entry.flushTimer) clearTimeout(entry.flushTimer)
        this.caches.delete(key)
      }
      try {
        const fp = this.filePath(key)
        if (fs.existsSync(fp)) fs.unlinkSync(fp)
      } catch {}
    }
  }

  private pruneOld(): void {
    try {
      fs.readdir(CACHE_DIR, (err, files) => {
        if (err || !files) return
        const now = Date.now()
        for (const file of files) {
          if (!file.endsWith('.scrollback') && !file.includes('.scrollback.claim.')) continue
          const fp = path.join(CACHE_DIR, file)
          fs.stat(fp, (err2, stat) => {
            if (err2) return
            if (now - stat.mtimeMs > MAX_AGE_MS) {
              fs.unlink(fp, () => {})
            }
          })
        }
      })
    } catch {}
  }

  destroy(): void {
    this.flushAll()
    for (const entry of this.caches.values()) {
      if (entry.flushTimer) clearTimeout(entry.flushTimer)
    }
    this.caches.clear()
  }
}
