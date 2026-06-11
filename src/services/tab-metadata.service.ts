import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import { execFile } from 'child_process'
import * as path from 'path'
import { log, logError } from '../utils/logger'

export interface TabMetadata {
  cwd: string
  gitBranch: string | null
  ports: number[]
  pid: number | null
}

const isWindows = process.platform === 'win32'

function execFileAsync(cmd: string, args: string[], timeout = 3000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : (stdout || ''))
    })
  })
}

@Injectable({ providedIn: 'root' })
export class TabMetadataService {
  readonly metadata$ = new BehaviorSubject<Map<any, TabMetadata>>(new Map())
  private data = new Map<any, TabMetadata>()
  private intervals = new Map<any, any>()
  private refreshing = new Set<any>()
  private maxTracked = 20

  track(tab: any): void {
    if (this.data.has(tab)) return
    if (this.data.size >= this.maxTracked) return

    const cwd = tab?.profile?.options?.cwd || ''
    const entry: TabMetadata = { cwd, gitBranch: null, ports: [], pid: null }
    this.data.set(tab, entry)
    this.metadata$.next(new Map(this.data))

    this.refreshAsync(tab)

    const iv = setInterval(() => {
      if (!tab || tab.destroyed) { this.untrack(tab); return }
      this.refreshAsync(tab)
    }, 15000)
    this.intervals.set(tab, iv)

    if (tab.destroyed$?.subscribe) {
      tab.destroyed$.subscribe(() => this.untrack(tab))
    }
  }

  untrack(tab: any): void {
    const iv = this.intervals.get(tab)
    if (iv) clearInterval(iv)
    this.intervals.delete(tab)
    this.data.delete(tab)
    this.refreshing.delete(tab)
    this.metadata$.next(new Map(this.data))
  }

  get(tab: any): TabMetadata | undefined {
    return this.data.get(tab)
  }

  destroy(): void {
    for (const iv of this.intervals.values()) clearInterval(iv)
    this.intervals.clear()
    this.data.clear()
    this.refreshing.clear()
  }

  private async refreshAsync(tab: any): Promise<void> {
    if (this.refreshing.has(tab)) return
    this.refreshing.add(tab)

    try {
      const entry = this.data.get(tab)
      if (!entry) return

      const cwd = tab?.profile?.options?.cwd || entry.cwd
      entry.cwd = cwd
      entry.gitBranch = await this.getGitBranch(cwd)

      const pid = this.getTabPid(tab)
      entry.pid = pid
      entry.ports = pid ? await this.getListeningPorts(pid) : []

      this.metadata$.next(new Map(this.data))
    } catch (e: any) {
      logError('TabMetadata.refresh', e)
    } finally {
      this.refreshing.delete(tab)
    }
  }

  private async getGitBranch(cwd: string): Promise<string | null> {
    if (!cwd) return null
    try {
      const result = await execFileAsync('git', ['-C', cwd, 'branch', '--show-current'])
      return result.trim() || null
    } catch {
      return null
    }
  }

  private getTabPid(tab: any): number | null {
    try {
      if (tab.session?.pty?.pid) return tab.session.pty.pid
      if (tab.session?.process?.pid) return tab.session.process.pid
    } catch {}
    return null
  }

  private async getListeningPorts(pid: number): Promise<number[]> {
    const pidStr = String(pid)
    try {
      let result: string
      if (isWindows) {
        result = await execFileAsync('netstat', ['-ano', '-p', 'TCP'])
      } else {
        result = await execFileAsync('ss', ['-tlnp'])
      }
      if (!result) return []

      const ports: number[] = []
      for (const line of result.split('\n')) {
        if (isWindows) {
          if (!line.includes('LISTENING')) continue
          if (!line.trimEnd().endsWith(pidStr)) continue
        } else {
          if (!line.includes(`pid=${pidStr},`) && !line.includes(`pid=${pidStr})`)) continue
        }

        const match = line.match(/:(\d+)\s/)
        if (match) {
          const port = parseInt(match[1], 10)
          if (port > 1024 && port <= 65535 && !ports.includes(port)) {
            ports.push(port)
          }
        }
      }
      return ports.slice(0, 5)
    } catch {
      return []
    }
  }
}
