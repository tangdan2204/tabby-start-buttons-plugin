import { Injectable } from '@angular/core'
import { log } from '../utils/logger'
import { RUNTIME_INSTANCE_ID } from '../utils/runtime-instance'

const STORAGE_KEY = 'agent-mux-active-sessions'
const ACTIVE_RUNS_KEY = 'tabby-agent-mux-active-runs'
const RUN_STALE_MS = 90 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const SESSION_MAX = 100

export interface SavedSession {
  id: string
  ownerId: string
  kind: string
  cwd: string
  title: string
  savedAt: number
}

interface ActiveRun {
  id: string
  ts: number
}

function isNonEmptyString(v: any): v is string {
  return typeof v === 'string' && v.length > 0
}

function isValidSessionPayload(s: any): boolean {
  return s != null &&
    typeof s === 'object' &&
    isNonEmptyString(s.kind) &&
    isNonEmptyString(s.cwd) &&
    isNonEmptyString(s.title) &&
    typeof s.savedAt === 'number' &&
    isFinite(s.savedAt)
}

function makeSessionId(savedAt: number): string {
  return [
    RUNTIME_INSTANCE_ID,
    savedAt.toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join('-')
}

function normalizeSession(raw: any): SavedSession | null {
  if (!isValidSessionPayload(raw)) return null
  const savedAt = raw.savedAt
  return {
    id: isNonEmptyString(raw.id) ? raw.id : makeSessionId(savedAt),
    ownerId: isNonEmptyString(raw.ownerId) ? raw.ownerId : 'legacy',
    kind: raw.kind,
    cwd: raw.cwd,
    title: raw.title,
    savedAt,
  }
}

function readActiveRunIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set<string>()
  const now = Date.now()
  try {
    const raw = localStorage.getItem(ACTIVE_RUNS_KEY)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<string>()

    const ids = new Set<string>()
    for (const item of parsed as ActiveRun[]) {
      if (!item || !isNonEmptyString(item.id) || typeof item.ts !== 'number' || !isFinite(item.ts)) continue
      if (now - item.ts <= RUN_STALE_MS) ids.add(item.id)
    }
    return ids
  } catch {
    return new Set<string>()
  }
}

@Injectable({ providedIn: 'root' })
export class SessionPersistService {
  private sessions: SavedSession[] = []

  constructor() {
    this.load()
  }

  save(kind: string, cwd: string, title: string): string {
    const savedAt = Date.now()
    const session: SavedSession = {
      id: makeSessionId(savedAt),
      ownerId: RUNTIME_INSTANCE_ID,
      kind,
      cwd,
      title,
      savedAt,
    }
    this.sessions.push(session)
    if (this.sessions.length > SESSION_MAX) {
      this.sessions = this.sessions
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, SESSION_MAX)
    }
    this.persist()
    return session.id
  }

  removeById(id: string): void {
    this.sessions = this.sessions.filter(s => s.id !== id)
    this.persist()
  }

  removeMany(ids: string[]): void {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    this.sessions = this.sessions.filter(s => !idSet.has(s.id))
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

  getRecoverable(): SavedSession[] {
    const activeOwners = readActiveRunIds()
    return this.sessions
      .filter(s => !activeOwners.has(s.ownerId))
      .sort((a, b) => b.savedAt - a.savedAt)
  }

  hasRecoverable(): boolean {
    return this.getRecoverable().length > 0
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
          const cutoff = Date.now() - SESSION_TTL_MS
          const normalized: SavedSession[] = []
          for (const item of parsed) {
            const session = normalizeSession(item)
            if (!session) continue
            if (session.savedAt <= cutoff) continue
            normalized.push(session)
          }
          this.sessions = normalized
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(0, SESSION_MAX)
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
    log(`SessionPersist: loaded ${this.sessions.length} sessions`)
  }
}
