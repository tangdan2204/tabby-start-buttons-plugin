import { Injectable } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService } from 'tabby-core'
import { log } from '../utils/logger'

@Injectable({ providedIn: 'root' })
export class PasteGuardService {
  private alive = new Subscription()
  private patchedSessions = new WeakSet<any>()
  private lastRightClickTime = 0
  private lastPasteContent = ''
  private lastPasteTime = 0
  private started = false
  private destroyed = false

  constructor(private appService: AppService) {}

  start(): void {
    if (this.started || this.destroyed) return
    this.started = true
    if (typeof document === 'undefined') return

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) this.lastRightClickTime = Date.now()
    }
    const onPaste = (e: ClipboardEvent) => {
      const elapsed = Date.now() - this.lastRightClickTime
      if (elapsed < 100) {
        const target = e.target as HTMLElement
        const isXterm = target.closest('.xterm') || target.closest('.terminal-wrapper') || target.closest('xterm-screen')
        if (isXterm) {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }
    }

    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('paste', onPaste, true)
    this.alive.add(new Subscription(() => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('paste', onPaste, true)
    }))

    const patchSessionWrite = (session: any) => {
      if (!session?.write || this.patchedSessions.has(session)) return
      this.patchedSessions.add(session)
      const originalWrite = session.write.bind(session)
      session.write = (data: any) => {
        const now = Date.now()
        const text = typeof data === 'string' ? data : data?.toString?.() || ''
        if (
          now - this.lastRightClickTime < 300 &&
          text.length > 1 &&
          text === this.lastPasteContent &&
          now - this.lastPasteTime < 150
        ) {
          log('PasteGuard: blocked duplicate write')
          return
        }
        if (now - this.lastRightClickTime < 300 && text.length > 1) {
          this.lastPasteContent = text
          this.lastPasteTime = now
        }
        originalWrite(data)
      }
    }

    const tryPatchTab = (tab: any) => {
      if (tab?.session) patchSessionWrite(tab.session)
    }

    const tryPatchActive = () => {
      if (this.destroyed) return
      tryPatchTab((this.appService as any).activeTab)
    }

    if ((this.appService as any).activeTabChange$?.subscribe) {
      this.alive.add((this.appService as any).activeTabChange$.subscribe(() => {
        if (this.destroyed) return
        setTimeout(tryPatchActive, 100)
      }))
    }
    if ((this.appService as any).tabOpened$?.subscribe) {
      this.alive.add((this.appService as any).tabOpened$.subscribe((tab: any) => {
        let waitRetries = 0
        const waitSession = () => {
          if (this.destroyed) return
          if (tab?.session) patchSessionWrite(tab.session)
          else if (!tab?.destroyed && ++waitRetries < 15) setTimeout(waitSession, 300)
        }
        setTimeout(waitSession, 200)
      }))
    }
    setTimeout(tryPatchActive, 500)

    log('PasteGuardService: session-level dedup guard active')
  }

  destroy(): void {
    this.destroyed = true
    this.alive.unsubscribe()
  }
}
