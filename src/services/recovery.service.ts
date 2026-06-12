import { Injectable } from '@angular/core'
import * as path from 'path'
import { AppService, NotificationsService } from 'tabby-core'
import { SessionPersistService } from './session-persist.service'
import { ScrollbackCacheService } from './scrollback-cache.service'
import { LaunchService } from './launch.service'
import { log } from '../utils/logger'
import { RUNTIME_INSTANCE_ID } from '../utils/runtime-instance'

const ACTIVE_RUNS_KEY = 'tabby-agent-mux-active-runs'
const RUN_STALE_MS = 90 * 1000
const RUN_HEARTBEAT_MS = 15 * 1000

interface ActiveRun {
  id: string
  ts: number
}

@Injectable({ providedIn: 'root' })
export class RecoveryService {
  private destroyed = false
  private restoring = false
  private beforeUnloadHandler: (() => void) | null = null
  private heartbeatTimer: any = null
  private readonly runToken = RUNTIME_INSTANCE_ID

  constructor(
    private appService: AppService,
    private notifications: NotificationsService,
    private sessionPersist: SessionPersistService,
    private scrollbackCache: ScrollbackCacheService,
    private launchService: LaunchService,
  ) {}

  start(): void {
    this.autoRestoreIfNeeded()
  }

  async restoreSessions(): Promise<void> {
    if (this.restoring || this.destroyed) return
    this.restoring = true
    try {
      const sessions = this.sessionPersist.getRecoverable()
      if (sessions.length === 0) {
        this.notifications.info('No recoverable sessions')
        return
      }

      const restoredIds: string[] = []
      let restored = 0
      for (const s of sessions) {
        if (this.destroyed) break
        const scrollback = this.scrollbackCache.recover(s.id, s.kind, s.cwd)
        const tab = await this.launchService.launchInDirAndReturn(s.kind, s.cwd)
        if (!tab) continue

        if (scrollback) {
          this.injectScrollbackHistory(tab, scrollback, s.kind, s.cwd)
        }
        restored++
        restoredIds.push(s.id)
      }
      this.sessionPersist.removeMany(restoredIds)
      this.notifications.info(`Restored ${restored} Agent sessions`)
    } finally {
      this.restoring = false
    }
  }

  attachScrollbackCapture(tab: any, sessionId: string, kind: string, cwd: string): void {
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

  destroy(): void {
    this.destroyed = true
    if (this.beforeUnloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler)
      this.beforeUnloadHandler = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.unregisterActiveRun()
  }

  private autoRestoreIfNeeded(): void {
    if (typeof localStorage === 'undefined') return

    const staleRunDetected = this.registerActiveRun()
    this.startHeartbeat()

    this.beforeUnloadHandler = () => {
      this.unregisterActiveRun()
    }
    window.addEventListener('beforeunload', this.beforeUnloadHandler)

    const sessions = this.sessionPersist.getRecoverable()
    if (sessions.length === 0 || !staleRunDetected) return

    log(`RecoveryService: crash recovery - found ${sessions.length} sessions`)
    setTimeout(() => {
      if (this.destroyed) return
      this.notifications.info(`Detected ${sessions.length} unclean sessions, recovering...`)
      this.restoreSessions()
    }, 2000)
  }

  private readActiveRuns(): ActiveRun[] {
    try {
      const raw = localStorage.getItem(ACTIVE_RUNS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((r: any) =>
        r &&
        typeof r.id === 'string' &&
        r.id.length > 0 &&
        typeof r.ts === 'number' &&
        isFinite(r.ts))
    } catch {
      return []
    }
  }

  private writeActiveRuns(runs: ActiveRun[]): void {
    try {
      localStorage.setItem(ACTIVE_RUNS_KEY, JSON.stringify(runs.slice(-32)))
    } catch {}
  }

  private registerActiveRun(): boolean {
    const now = Date.now()
    const current = this.readActiveRuns()
    const alive = current.filter(r => now - r.ts <= RUN_STALE_MS && r.id !== this.runToken)
    const staleDetected = current.length !== alive.length
    alive.push({ id: this.runToken, ts: now })
    this.writeActiveRuns(alive)
    return staleDetected
  }

  private refreshActiveRun(): void {
    const now = Date.now()
    const current = this.readActiveRuns()
    const alive = current.filter(r => now - r.ts <= RUN_STALE_MS && r.id !== this.runToken)
    alive.push({ id: this.runToken, ts: now })
    this.writeActiveRuns(alive)
  }

  private unregisterActiveRun(): void {
    if (typeof localStorage === 'undefined') return
    const now = Date.now()
    const current = this.readActiveRuns()
    const alive = current.filter(r => now - r.ts <= RUN_STALE_MS && r.id !== this.runToken)
    this.writeActiveRuns(alive)
  }

  private startHeartbeat(): void {
    this.refreshActiveRun()
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed) return
      this.refreshActiveRun()
    }, RUN_HEARTBEAT_MS)
  }

  private injectScrollbackHistory(tab: any, scrollback: string, kind: string, cwd: string): void {
    let retries = 0
    const waitForSession = () => {
      if (tab.destroyed || ++retries > 15) return
      const session = tab.session
      if (!session?.emitOutput) {
        setTimeout(waitForSession, 300)
        return
      }

      const header = [
        '\x1b[90m',
        '------------------------------------------------------------',
        `  Recovered crash scrollback (${kind} @ ${path.basename(cwd)})`,
        '------------------------------------------------------------',
        '\x1b[0m',
        '',
      ].join('\r\n')

      const lines = scrollback.split('\n')
      const tail = lines.slice(-200).join('\r\n')

      setTimeout(() => {
        try {
          const content = header + tail + '\r\n\x1b[90m--- end of recovered scrollback ---\x1b[0m\r\n\r\n'
          session.emitOutput(Buffer.from(content))
        } catch {}
      }, 500)
    }

    setTimeout(waitForSession, 200)
  }
}
