import { Injectable } from '@angular/core'
import { log } from '../utils/logger'

const STORAGE_KEY = 'agent-mux-active-sessions'

export interface SavedSession {
  kind: string
  cwd: string
  title: string
  savedAt: number
}

function isValidSession(s: any): s is SavedSession {
  return s != null &&
    typeof s === 'object' &&
    typeof s.kind === 'string' &&
    typeof s.cwd === 'string' &&
    typeof s.title === 'string' &&
    typeof s.savedAt === 'number' &&
    isFinite(s.savedAt)
}

@Injectable({ providedIn: 'root' })
export class SessionPersistService {
  private sessions: SavedSession[] = []

  constructor() {
    this.load()
  }

  save(kind: string, cwd: string, title: string): void {
    const existing = this.sessions.findIndex(s => s.kind === kind && s.cwd === cwd)
    if (existing >= 0) {
      this.sessions[existing].savedAt = Date.now()
      this.sessions[existing].title = title
    } else {
      if (this.sessions.length >= 50) return
      this.sessions.push({ kind, cwd, title, savedAt: Date.now() })
    }
    this.persist()
  }

  remove(kind: string, cwd: string): void {
    this.sessions = this.sessions.filter(s => !(s.kind === kind && s.cwd === cwd))
    this.persist()
  }

  clear(): void {
    this.sessions = []
    this.persist()
  }

  getAll(): SavedSession[] {
    return [...this.sessions]
  }

  hasRecoverable(): boolean {
    return this.sessions.length > 0
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions))
    } catch {}
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000
          this.sessions = parsed.filter((s: any) => isValidSession(s) && s.savedAt > cutoff)
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    log(`SessionPersist: loaded ${this.sessions.length} recoverable sessions`)
  }
}
