import { log } from '../utils/logger'

export class ProcessKeepAlive {
  private watchedTabs = new Map<any, { kind: string; cwd: string; onRestart: () => void }>()
  private outputSubs = new WeakMap<any, any>()

  watch(tab: any, kind: string, cwd: string, onRestart: () => void): void {
    if (this.watchedTabs.has(tab)) return
    this.watchedTabs.set(tab, { kind, cwd, onRestart })
    this.attachExitDetector(tab)
  }

  unwatch(tab: any): void {
    this.watchedTabs.delete(tab)
    const sub = this.outputSubs.get(tab)
    if (sub) {
      try { sub.unsubscribe() } catch {}
      this.outputSubs.delete(tab)
    }
  }

  private attachExitDetector(tab: any): void {
    const waitForSession = () => {
      if (!tab || tab.destroyed) return
      const session = tab.session
      if (!session?.output$?.subscribe) {
        setTimeout(waitForSession, 500)
        return
      }

      const sub = session.output$.subscribe((data: any) => {
        const text = typeof data === 'string' ? data : data?.toString?.() || ''
        if (text.includes('Press any key to close')) {
          sub.unsubscribe()
          this.outputSubs.delete(tab)
          this.handleProcessExit(tab)
        }
      })
      this.outputSubs.set(tab, sub)
    }

    setTimeout(waitForSession, 300)
  }

  private handleProcessExit(tab: any): void {
    if (!tab || tab.destroyed) return
    const info = this.watchedTabs.get(tab)
    if (!info) return

    log(`ProcessKeepAlive: agent exited (${info.kind} @ ${info.cwd})`)

    const session = tab.session
    if (!session) return

    const restartMsg = Buffer.from(
      '\r\n\x1b[36m  ↑ 按 Enter 重启 Agent | 按其他键关闭标签\x1b[0m\r\n'
    )
    try {
      if (session.emitOutput) {
        session.emitOutput(restartMsg)
      }
    } catch {}

    const originalWrite = session.write.bind(session)
    let intercepted = false

    session.write = (data: any) => {
      if (intercepted) return
      intercepted = true

      const text = typeof data === 'string' ? data : data?.toString?.() || ''
      const isEnter = text.includes('\r') || text.includes('\n')

      session.write = originalWrite

      if (isEnter) {
        log(`ProcessKeepAlive: restarting ${info.kind} @ ${info.cwd}`)
        this.watchedTabs.delete(tab)
        try { tab.destroy() } catch {}
        info.onRestart()
      } else {
        originalWrite(data)
      }
    }
  }

  destroy(): void {
    this.watchedTabs.clear()
  }
}
