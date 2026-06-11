import { log } from '../utils/logger'

const MODAL_ID = 'agent-mux-protect-modal'
const MODAL_CSS_ID = 'agent-mux-protect-modal-css'

const MODAL_CSS = `
  #${MODAL_ID} {
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.5);
    font-family: system-ui, sans-serif;
  }
  #${MODAL_ID} .modal-box {
    background: var(--theme-bg-more, #1e1e2e);
    border: 1px solid var(--theme-border, #313244);
    border-radius: 8px;
    padding: 24px;
    max-width: 360px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  #${MODAL_ID} .modal-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--theme-fg, #cdd6f4);
    margin-bottom: 8px;
  }
  #${MODAL_ID} .modal-body {
    font-size: 12px;
    color: var(--theme-fg-muted, #a6adc8);
    margin-bottom: 16px;
    line-height: 1.5;
  }
  #${MODAL_ID} .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  #${MODAL_ID} .modal-btn {
    padding: 6px 16px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    min-width: 64px;
    min-height: 32px;
  }
  #${MODAL_ID} .modal-btn:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }
  #${MODAL_ID} .modal-btn-cancel {
    background: var(--theme-bg, #313244);
    color: var(--theme-fg, #cdd6f4);
  }
  #${MODAL_ID} .modal-btn-cancel:hover { opacity: 0.85; }
  #${MODAL_ID} .modal-btn-confirm {
    background: #ef4444;
    color: #fff;
  }
  #${MODAL_ID} .modal-btn-confirm:hover { background: #dc2626; }
`

export class TabProtection {
  private appService: any
  private notifications: any
  private protectedTabs = new WeakSet<any>()
  private protectedTabsList: any[] = []
  private styleInjected = false
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => any) | null = null
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null
  private electronCloseHandler: ((e: any) => void) | null = null
  private electronWindow: any = null
  private onProtectedCountChange: ((count: number) => void) | null = null

  constructor(appService: any, notifications: any) {
    this.appService = appService
    this.notifications = notifications
  }

  setOnProtectedCountChange(cb: (count: number) => void): void {
    this.onProtectedCountChange = cb
  }

  init(): void {
    this.injectStyles()
    this.installWindowGuard()
    this.installKeyboardGuard()
    this.installElectronCloseGuard()
    this.installLastTabGuard()
    log('TabProtection initialized (canClose + window + keyboard + electron guard)')
  }

  getProtectedCount(): number {
    return this.protectedTabsList.length
  }

  private installWindowGuard(): void {
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.protectedTabsList.length > 0) {
        const msg = `有 ${this.protectedTabsList.length} 个受保护的 Agent 标签正在运行，确定关闭窗口？`
        e.preventDefault()
        e.returnValue = msg
        return msg
      }
    }
    window.addEventListener('beforeunload', this.beforeUnloadHandler)
  }

  private installKeyboardGuard(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      const activeTab = (this.appService as any).activeTab
      if (!activeTab || !this.protectedTabs.has(activeTab)) return

      const isCloseShortcut =
        (e.ctrlKey && e.key === 'w') ||
        (e.ctrlKey && e.key === 'W') ||
        (e.ctrlKey && e.key === 'F4') ||
        (e.altKey && e.key === 'F4')

      if (isCloseShortcut) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        log(`TabProtection: blocked ${e.ctrlKey ? 'Ctrl' : 'Alt'}+${e.key} on protected tab`)
        this.flashProtectedIndicator(activeTab)
      }
    }
    window.addEventListener('keydown', this.keydownHandler, true)
  }

  private installElectronCloseGuard(): void {
    try {
      const electronRemote = require('@electron/remote')
      this.electronWindow = electronRemote.getCurrentWindow()
      if (!this.electronWindow) return

      this.electronCloseHandler = (e: any) => {
        if (this.protectedTabsList.length > 0) {
          e.preventDefault()
          log(`TabProtection: Electron close event blocked (${this.protectedTabsList.length} protected)`)
          this.notifications.error(`${this.protectedTabsList.length} 个 Agent 正在运行，无法关闭窗口`)
        }
      }
      this.electronWindow.on('close', this.electronCloseHandler)
      log('TabProtection: Electron close guard installed')
    } catch (e: any) {
      log(`TabProtection: Electron guard not available (${e.message})`)
    }
  }

  private installLastTabGuard(): void {
    try {
      if (!(this.appService as any).tabClosed$?.subscribe) return
      (this.appService as any).tabClosed$.subscribe(() => {
        const tabs = (this.appService as any).tabs || []
        if (tabs.length === 0 && this.protectedTabsList.length > 0) {
          log('TabProtection: last tab closed but protected sessions exist, preventing window close')
        }
      })
    } catch {}
  }

  private flashProtectedIndicator(_tab: any): void {
    this.notifications.info('标签已锁定保护，无法通过快捷键关闭')
  }

  protect(tab: any): void {
    if (this.protectedTabs.has(tab)) return
    this.protectedTabs.add(tab)
    this.protectedTabsList.push(tab)

    const originalCanClose = tab.canClose?.bind(tab)
    tab.canClose = async (): Promise<boolean> => {
      if (!this.protectedTabs.has(tab)) {
        return originalCanClose ? originalCanClose() : true
      }
      const confirmed = await this.showConfirmModal(tab)
      if (confirmed) {
        this.unprotect(tab)
      }
      return confirmed
    }

    if (tab.destroyed$?.subscribe) {
      tab.destroyed$.subscribe(() => this.cleanup(tab))
    }

    this.updateTabVisual(tab, true)
    this.notifyCountChange()
  }

  unprotect(tab: any): void {
    if (!this.protectedTabs.has(tab)) return
    this.protectedTabs.delete(tab)
    this.protectedTabsList = this.protectedTabsList.filter(t => t !== tab)
    this.updateTabVisual(tab, false)
    this.notifyCountChange()
  }

  isProtected(tab: any): boolean {
    return this.protectedTabs.has(tab)
  }

  destroy(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler)
      this.beforeUnloadHandler = null
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, true)
      this.keydownHandler = null
    }
    if (this.electronWindow && this.electronCloseHandler) {
      this.electronWindow.removeListener('close', this.electronCloseHandler)
      this.electronCloseHandler = null
    }
    for (const tab of this.protectedTabsList) {
      this.updateTabVisual(tab, false)
    }
    this.protectedTabsList = []
    this.notifyCountChange()
    document.getElementById(MODAL_CSS_ID)?.remove()
  }

  private cleanup(tab: any): void {
    this.protectedTabs.delete(tab)
    this.protectedTabsList = this.protectedTabsList.filter(t => t !== tab)
    this.notifyCountChange()
  }

  private notifyCountChange(): void {
    if (this.onProtectedCountChange) {
      this.onProtectedCountChange(this.protectedTabsList.length)
    }
  }

  private updateTabVisual(tab: any, locked: boolean): void {
    try {
      const el = tab.element?.nativeElement || tab.elementRef?.nativeElement
      if (el) {
        el.classList.toggle('agent-mux-locked', locked)
      }
    } catch {}
  }

  private showConfirmModal(tab: any): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (document.getElementById(MODAL_ID)) {
        resolve(false)
        return
      }

      const title = tab.customTitle || tab.title || 'Terminal'
      const modal = document.createElement('div')
      modal.id = MODAL_ID
      modal.setAttribute('role', 'dialog')
      modal.setAttribute('aria-modal', 'true')
      modal.setAttribute('aria-labelledby', 'protect-modal-title')

      modal.innerHTML = `
        <div class="modal-box">
          <div class="modal-title" id="protect-modal-title">关闭受保护的标签？</div>
          <div class="modal-body">标签 "${this.escapeHtml(title)}" 已锁定保护。关闭后无法恢复会话内容。</div>
          <div class="modal-actions">
            <button class="modal-btn modal-btn-cancel" data-action="cancel">取消</button>
            <button class="modal-btn modal-btn-confirm" data-action="confirm">确认关闭</button>
          </div>
        </div>
      `

      const cleanup = (result: boolean) => {
        modal.remove()
        document.removeEventListener('keydown', onKey)
        resolve(result)
      }

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') cleanup(false)
        else if (e.key === 'Enter') cleanup(true)
      }

      modal.addEventListener('click', (e: Event) => {
        const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
        if (btn) {
          cleanup(btn.dataset.action === 'confirm')
        } else if (e.target === modal) {
          cleanup(false)
        }
      })

      document.addEventListener('keydown', onKey)
      document.body.appendChild(modal)

      const cancelBtn = modal.querySelector('.modal-btn-cancel') as HTMLElement
      cancelBtn?.focus()
    })
  }

  private injectStyles(): void {
    if (this.styleInjected || document.getElementById(MODAL_CSS_ID)) return
    const style = document.createElement('style')
    style.id = MODAL_CSS_ID
    style.textContent = MODAL_CSS
    document.head.appendChild(style)
    this.styleInjected = true
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
