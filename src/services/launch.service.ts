import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as path from 'path'
import { ProfilesService, NotificationsService, AppService } from 'tabby-core'
import { log, logError } from '../utils/logger'
import { ConfigService } from '../config'
import { SessionPersistService } from './session-persist.service'
import { ProcessKeepAliveService } from './process-keepalive.service'
import { ScrollbackCacheService } from './scrollback-cache.service'
import { TabProtection } from '../ui/tab-protection'

const HISTORY_DIR = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'tabby-agent-mux')
const HISTORY_FILE = path.join(
  HISTORY_DIR,
  `history-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`,
)
const LEGACY_HISTORY_FILE = path.join(HISTORY_DIR, 'history.json')
const HISTORY_FILE_PATTERN = /^history(?:-[a-z0-9-]+)?\.json$/i
const HISTORY_MAX = 20
const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const HISTORY_CACHE_TTL_MS = 1000

interface HistoryEntry {
  kind: string
  cwd: string
  ts: number
}

let historyCache: HistoryEntry[] = []
let historyCacheAt = 0

function ensureHistoryDir(): void {
  try { fs.mkdirSync(HISTORY_DIR, { recursive: true }) } catch {}
}

function isHistoryEntry(item: any): item is HistoryEntry {
  return item != null &&
    typeof item.kind === 'string' &&
    item.kind.length > 0 &&
    typeof item.cwd === 'string' &&
    item.cwd.length > 0 &&
    typeof item.ts === 'number' &&
    isFinite(item.ts)
}

function normalizeHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const dedup = new Map<string, HistoryEntry>()
  const cutoff = Date.now() - HISTORY_RETENTION_MS
  for (const entry of entries) {
    if (!isHistoryEntry(entry)) continue
    if (entry.ts < cutoff) continue
    const key = `${entry.kind}\n${entry.cwd}`
    const prev = dedup.get(key)
    if (!prev || prev.ts < entry.ts) dedup.set(key, entry)
  }
  return Array.from(dedup.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, HISTORY_MAX)
}

function readHistoryFile(filePath: string): HistoryEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isHistoryEntry)
  } catch {
    return []
  }
}

function listHistoryFiles(): string[] {
  try {
    ensureHistoryDir()
    const files = fs.readdirSync(HISTORY_DIR)
      .filter(name => HISTORY_FILE_PATTERN.test(name))
      .map(name => path.join(HISTORY_DIR, name))
    if (files.length === 0 && fs.existsSync(LEGACY_HISTORY_FILE)) return [LEGACY_HISTORY_FILE]
    return files
  } catch {
    return []
  }
}

function pruneOldHistoryFiles(): void {
  try {
    ensureHistoryDir()
    const now = Date.now()
    const files = fs.readdirSync(HISTORY_DIR)
    for (const file of files) {
      if (!file.startsWith('history-') || !file.endsWith('.json')) continue
      const fullPath = path.join(HISTORY_DIR, file)
      try {
        const stat = fs.statSync(fullPath)
        if (now - stat.mtimeMs > HISTORY_RETENTION_MS) fs.unlinkSync(fullPath)
      } catch {}
    }
  } catch {}
}

function loadHistory(force = false): HistoryEntry[] {
  const now = Date.now()
  if (!force && now - historyCacheAt < HISTORY_CACHE_TTL_MS) return historyCache

  const files = listHistoryFiles()
  const merged: HistoryEntry[] = []
  for (const filePath of files) {
    merged.push(...readHistoryFile(filePath))
  }

  historyCache = normalizeHistory(merged)
  historyCacheAt = now
  pruneOldHistoryFiles()
  return historyCache
}

function saveHistory(kind: string, cwd: string): void {
  if (!kind || !cwd) return
  try {
    ensureHistoryDir()
    const ownList = readHistoryFile(HISTORY_FILE)
    const next = normalizeHistory([{ kind, cwd, ts: Date.now() }, ...ownList])
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(next, null, 2), 'utf-8')
    historyCacheAt = 0
  } catch (e: any) {
    logError('saveHistory', e)
  }
}

@Injectable({ providedIn: 'root' })
export class LaunchService {
  private lastProjectCwd: string
  private destroyed = false
  private tabProtection: TabProtection | null = null

  constructor(
    private profilesService: ProfilesService,
    private notifications: NotificationsService,
    private appService: AppService,
    private configService: ConfigService,
    private sessionPersist: SessionPersistService,
    private processKeepAlive: ProcessKeepAliveService,
    private scrollbackCache: ScrollbackCacheService,
  ) {
    this.lastProjectCwd = configService.get().defaultProjectDir
  }

  setTabProtection(tp: TabProtection): void {
    this.tabProtection = tp
  }

  markDestroyed(): void {
    this.destroyed = true
  }

  getLastProjectCwd(): string {
    return this.lastProjectCwd
  }

  setLastProjectCwd(cwd: string): void {
    this.lastProjectCwd = cwd
  }

  getHistory(): any[] {
    return loadHistory()
  }

  async launch(profile: any): Promise<any> {
    if (this.destroyed) return null
    try {
      log('launch: ' + profile.name)
      const tab = await this.profilesService.openNewTabForProfile(profile)
      if (!tab) { log('launch FAILED: tab is null'); return null }

      const cwd = profile.options?.cwd || ''
      const title = String(profile.name || path.basename(cwd) || 'Terminal').trim()
      const profileKind = profile.id?.includes('codex') ? 'codex' : profile.id?.includes('claude') ? 'claude' : ''
      let sessionId = ''

      tab.customTitle = title
      tab.disableDynamicTitle = true
      if (tab.inputs) {
        tab.inputs.customTitle = title
        tab.inputs.disableDynamicTitle = true
      }
      if (this.tabProtection) this.tabProtection.protect(tab)

      if (profileKind) {
        sessionId = this.sessionPersist.save(profileKind, cwd, title)

        this.processKeepAlive.watch(tab, profileKind, cwd, () => {
          this.launchInDir(profileKind, cwd)
        })

        this.attachScrollbackCapture(tab, sessionId, profileKind, cwd)
      }

      if (tab.destroyed$?.subscribe) {
        tab.destroyed$.subscribe(() => {
          if (profileKind) {
            this.processKeepAlive.unwatch(tab)
            this.scrollbackCache.flushAll()
            if (sessionId) {
              this.sessionPersist.removeById(sessionId)
              this.scrollbackCache.remove(sessionId, profileKind, cwd)
            }
          }
        })
      }

      log(`Tab launched: ${title}`)
      return tab
    } catch (e: any) {
      logError('launch', e)
      this.notifications.error('启动失败: ' + (e.message || e))
      return null
    }
  }

  chooseProjectDirectory(): string | null {
    let electronRemote: any = null
    try { electronRemote = require('@electron/remote') } catch {}

    let selected: string | null = null
    if (electronRemote?.dialog) {
      try {
        const result = electronRemote.dialog.showOpenDialogSync({
          title: '选择工程目录',
          defaultPath: this.lastProjectCwd,
          properties: ['openDirectory'],
        })
        if (result?.length > 0) selected = result[0]
      } catch {}
    }
    if (!selected && typeof window !== 'undefined' && window.prompt) {
      const input = window.prompt('输入工程目录路径', this.lastProjectCwd)
      if (input === null) return null
      selected = String(input).trim().replace(/^"(.*)"$/, '$1')
    }
    if (!selected) return null
    const resolved = path.resolve(selected)
    try {
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        this.notifications.error('目录不存在: ' + resolved)
        return null
      }
    } catch (e: any) { this.notifications.error('目录校验失败: ' + e.message); return null }
    this.lastProjectCwd = resolved
    return resolved
  }

  async launchKind(kind: string): Promise<void> {
    const cwd = this.chooseProjectDirectory()
    if (!cwd) return
    if (kind === 'codex') await this.launch(this.configService.makeCodexProfile(cwd))
    else await this.launch(this.configService.makeClaudeProfile(cwd))
    saveHistory(kind, cwd)
  }

  async launchInDir(kind: string, cwd: string): Promise<void> {
    if (!cwd) return
    this.lastProjectCwd = cwd
    if (kind === 'codex') await this.launch(this.configService.makeCodexProfile(cwd))
    else if (kind === 'claude') await this.launch(this.configService.makeClaudeProfile(cwd))
    else await this.launch(this.configService.makeShellProfile(cwd))
    if (kind === 'codex' || kind === 'claude') saveHistory(kind, cwd)
  }

  async launchInDirAndReturn(kind: string, cwd: string): Promise<any> {
    if (!cwd) return null
    this.lastProjectCwd = cwd
    if (kind === 'codex') return this.launch(this.configService.makeCodexProfile(cwd))
    else if (kind === 'claude') return this.launch(this.configService.makeClaudeProfile(cwd))
    else return this.launch(this.configService.makeShellProfile(cwd))
  }

  private attachScrollbackCapture(tab: any, sessionId: string, kind: string, cwd: string): void {
    let retries = 0
    const waitForSession = () => {
      if (tab.destroyed || ++retries > 15) return
      if (tab.session?.output$?.subscribe) {
        const sub = tab.session.output$.subscribe((data: any) => {
          const text = typeof data === 'string' ? data : data?.toString?.() || ''
          if (text) this.scrollbackCache.append(sessionId, kind, cwd, text)
        })
        if (tab.destroyed$?.subscribe) {
          tab.destroyed$.subscribe(() => { try { sub.unsubscribe() } catch {} })
        }
      } else {
        setTimeout(waitForSession, 500)
      }
    }
    setTimeout(waitForSession, 300)
  }
}
