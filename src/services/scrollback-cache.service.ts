import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as path from 'path'
import { log, logError } from '../utils/logger'

const CACHE_DIR = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'tabby-agent-mux', 'scrollback')
const MAX_LINES = 5000
const FLUSH_INTERVAL = 3000
const MAX_AGE_MS = 4 * 60 * 60 * 1000

interface CacheEntry {
  lines: string[]
  dirty: boolean
  filePath: string
  flushTimer: any
}

@Injectable({ providedIn: 'root' })
export class ScrollbackCacheService {
  private caches = new Map<string, CacheEntry>()

  constructor() {
    this.ensureDir()
    this.pruneOld()
  }

  private ensureDir(): void {
    try {
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
    } catch {}
  }

  private sessionKey(kind: string, cwd: string): string {
    const safe = cwd.replace(/[\\/:*?"<>|]/g, '_').slice(-80)
    return `${kind}_${safe}`
  }

  private filePath(key: string): string {
    return path.join(CACHE_DIR, key + '.scrollback')
  }

  append(kind: string, cwd: string, data: string): void {
    const key = this.sessionKey(kind, cwd)
    let entry = this.caches.get(key)

    if (!entry) {
      entry = {
        lines: [],
        dirty: false,
        filePath: this.filePath(key),
        flushTimer: null,
      }
      this.caches.set(key, entry)
    }

    const newLines = data.split('\n')
    entry.lines.push(...newLines)
    if (entry.lines.length > MAX_LINES) {
      entry.lines = entry.lines.slice(-MAX_LINES)
    }
    entry.dirty = true

    if (!entry.flushTimer) {
      entry.flushTimer = setTimeout(() => {
        entry!.flushTimer = null
        this.flushEntry(key)
      }, FLUSH_INTERVAL)
    }
  }

  flushAll(): void {
    for (const key of this.caches.keys()) {
      this.flushEntry(key)
    }
  }

  private flushEntry(key: string): void {
    const entry = this.caches.get(key)
    if (!entry || !entry.dirty) return

    try {
      const content = entry.lines.join('\n')
      fs.writeFileSync(entry.filePath, content, 'utf-8')
      entry.dirty = false
    } catch (e: any) {
      logError('ScrollbackCache.flush', e)
    }
  }

  recover(kind: string, cwd: string): string | null {
    const key = this.sessionKey(kind, cwd)
    const fp = this.filePath(key)

    try {
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, 'utf-8')
        if (content.length > 0) {
          log(`ScrollbackCache: recovered ${content.split('\n').length} lines for ${kind}@${cwd}`)
          return content
        }
      }
    } catch {}
    return null
  }

  remove(kind: string, cwd: string): void {
    const key = this.sessionKey(kind, cwd)
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

  private pruneOld(): void {
    try {
      if (!fs.existsSync(CACHE_DIR)) return
      const now = Date.now()
      for (const file of fs.readdirSync(CACHE_DIR)) {
        if (!file.endsWith('.scrollback')) continue
        const fp = path.join(CACHE_DIR, file)
        try {
          const stat = fs.statSync(fp)
          if (now - stat.mtimeMs > MAX_AGE_MS) {
            fs.unlinkSync(fp)
          }
        } catch {}
      }
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
