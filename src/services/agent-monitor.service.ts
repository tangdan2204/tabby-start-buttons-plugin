import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import { log } from '../utils/logger'

export type AgentStatus = 'idle' | 'running' | 'waiting' | 'plan-review' | 'error' | 'complete'

export interface AgentState {
  status: AgentStatus
  lastOutput: string
  timestamp: number
  unread: boolean
  detectedPorts: number[]
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorService {
  readonly states$ = new BehaviorSubject<Map<any, AgentState>>(new Map())
  readonly unreadCount$ = new BehaviorSubject<number>(0)

  private states = new Map<any, AgentState>()
  private outputBuffers = new Map<any, string[]>()
  private analyzeTimers = new Map<any, any>()

  private lastEmittedStatus = new Map<any, AgentStatus>()

  private patterns = {
    waiting: [
      /^\s*\?\s/,
      /\[Y\/n\]/i,
      /\[y\/N\]/i,
      /Do you want to proceed/i,
      /Do you want to continue/i,
      /Press Enter/i,
      /Allow .+ to/i,
      /\(y\)es.*\(n\)o/i,
      /approve|deny/i,
      /waiting for.*input/i,
      /❯\s*$/,
    ],
    'plan-review': [
      /Plan mode is active/i,
      /ExitPlanMode/i,
      /Do you want me to/i,
      /Shall I proceed/i,
      /plan for approval/i,
    ],
    error: [
      /^Error:/m,
      /FAILED/,
      /panic:/i,
      /✗\s/,
      /FATAL/i,
      /Unhandled.*exception/i,
    ],
    complete: [
      /Done\.\s*$/,
      /Completed successfully/i,
      /Task complete/i,
      /✓\s.*done/i,
      /finished in/i,
    ],
  }

  private portPattern = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{3,5})/g

  updateOutput(tab: any, data: string): void {
    let buf = this.outputBuffers.get(tab)
    if (!buf) {
      buf = []
      this.outputBuffers.set(tab, buf)
    }

    const lines = data.split('\n')
    buf.push(...lines)
    if (buf.length > 100) {
      this.outputBuffers.set(tab, buf.slice(-100))
    }

    if (!this.analyzeTimers.has(tab)) {
      this.analyzeTimers.set(tab, setTimeout(() => {
        this.analyzeTimers.delete(tab)
        this.analyzeAndUpdate(tab)
      }, 500))
    }
  }

  getLastOutput(tab: any): string {
    const buf = this.outputBuffers.get(tab)
    if (!buf || buf.length === 0) return ''
    for (let i = buf.length - 1; i >= 0; i--) {
      const line = buf[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
      if (line.length > 0) return line.slice(0, 80)
    }
    return ''
  }

  markRead(tab: any): void {
    const state = this.states.get(tab)
    if (state && state.unread) {
      state.unread = false
      this.states$.next(new Map(this.states))
      this.recalcUnread()
    }
  }

  removeTab(tab: any): void {
    this.states.delete(tab)
    this.outputBuffers.delete(tab)
    const timer = this.analyzeTimers.get(tab)
    if (timer) { clearTimeout(timer); this.analyzeTimers.delete(tab) }
    this.states$.next(new Map(this.states))
    this.recalcUnread()
  }

  getState(tab: any): AgentState | undefined {
    return this.states.get(tab)
  }

  getNextUnreadTab(): any | null {
    for (const [tab, state] of this.states) {
      if (state.unread && (state.status === 'waiting' || state.status === 'plan-review')) {
        return tab
      }
    }
    for (const [tab, state] of this.states) {
      if (state.unread) return tab
    }
    return null
  }

  markAllRead(): void {
    for (const state of this.states.values()) {
      state.unread = false
    }
    this.states$.next(new Map(this.states))
    this.recalcUnread()
  }

  private analyzeAndUpdate(tab: any): void {
    const buf = this.outputBuffers.get(tab)
    if (!buf || buf.length === 0) return

    const recent = buf.slice(-8).join('\n')
    const cleanRecent = recent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

    let newStatus: AgentStatus = 'running'

    for (const pattern of this.patterns.waiting) {
      if (pattern.test(cleanRecent)) { newStatus = 'waiting'; break }
    }
    if (newStatus === 'running') {
      for (const pattern of this.patterns['plan-review']) {
        if (pattern.test(cleanRecent)) { newStatus = 'plan-review'; break }
      }
    }
    if (newStatus === 'running') {
      for (const pattern of this.patterns.error) {
        if (pattern.test(cleanRecent)) { newStatus = 'error'; break }
      }
    }
    if (newStatus === 'running') {
      for (const pattern of this.patterns.complete) {
        if (pattern.test(cleanRecent)) { newStatus = 'complete'; break }
      }
    }

    const detectedPorts = this.detectPorts(cleanRecent)
    const prev = this.states.get(tab)
    const prevStatus = prev?.status || 'idle'

    if (newStatus !== prevStatus) {
      const needsAttention = newStatus === 'waiting' || newStatus === 'plan-review' || newStatus === 'error'
      const state: AgentState = {
        status: newStatus,
        lastOutput: this.getLastOutput(tab),
        timestamp: Date.now(),
        unread: needsAttention,
        detectedPorts,
      }
      this.states.set(tab, state)
      this.lastEmittedStatus.set(tab, newStatus)
      this.states$.next(new Map(this.states))
      this.recalcUnread()

      if (needsAttention) {
        log(`Agent status changed: ${prevStatus} → ${newStatus}`)
      }
    } else if (prev) {
      prev.lastOutput = this.getLastOutput(tab)
      prev.timestamp = Date.now()
      if (detectedPorts.length > 0) {
        const merged = new Set([...prev.detectedPorts, ...detectedPorts])
        if (merged.size !== prev.detectedPorts.length) {
          prev.detectedPorts = [...merged]
          this.states$.next(new Map(this.states))
        }
      }
    }
  }

  private detectPorts(text: string): number[] {
    const ports = new Set<number>()
    let match: RegExpExecArray | null
    this.portPattern.lastIndex = 0
    while ((match = this.portPattern.exec(text)) !== null) {
      const port = parseInt(match[1], 10)
      if (port >= 1000 && port <= 65535) ports.add(port)
    }
    return [...ports]
  }

  private recalcUnread(): void {
    let count = 0
    for (const state of this.states.values()) {
      if (state.unread) count++
    }
    this.unreadCount$.next(count)
  }

  destroy(): void {
    for (const timer of this.analyzeTimers.values()) clearTimeout(timer)
    this.analyzeTimers.clear()
    this.states.clear()
    this.outputBuffers.clear()
    this.lastEmittedStatus.clear()
  }
}
