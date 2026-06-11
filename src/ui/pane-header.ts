import { Subscription } from 'rxjs'
import { log, logError } from '../utils/logger'

const PANE_HEADER_CSS_ID = 'agent-mux-pane-header-css'

const PANE_HEADER_CSS = `
  .agent-mux-pane-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 26px;
    background: var(--theme-bg-more, linear-gradient(180deg, #1a1a2e 0%, #16162a 100%));
    border-bottom: 1px solid var(--theme-border, #313244);
    display: flex;
    align-items: center;
    padding: 0 8px;
    z-index: 5;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    color: var(--theme-fg, #cdd6f4);
    gap: 6px;
    user-select: none;
    cursor: default;
  }
  .agent-mux-pane-header .pane-icon {
    font-size: 10px;
    opacity: 0.6;
  }
  .agent-mux-pane-header .pane-title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .agent-mux-pane-header .pane-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .agent-mux-pane-header .pane-badge.claude {
    background: #f59e0b33;
    color: #f59e0b;
  }
  .agent-mux-pane-header .pane-badge.codex {
    background: #38bdf833;
    color: #38bdf8;
  }
  .agent-mux-pane-header .pane-badge.shell {
    background: #10b98133;
    color: #10b981;
  }
  .agent-mux-pane-header .pane-btn {
    background: none;
    border: none;
    color: var(--theme-fg-muted, #6b7280);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .agent-mux-pane-header .pane-btn:hover {
    background: var(--theme-bg-hover, #313244);
    color: var(--theme-fg, #cdd6f4);
  }
  .agent-mux-pane-header .pane-btn:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: -2px;
  }

  .agent-mux-has-pane-header {
    position: relative;
  }
  .agent-mux-has-pane-header > :not(.agent-mux-pane-header) {
    margin-top: 26px;
  }
`

interface PaneInfo {
  tab: any
  headerEl: HTMLElement
  kind: string
  folderName: string
  subscription: Subscription | null
}

export class PaneHeader {
  private appService: any
  private panes = new WeakMap<any, PaneInfo>()
  private paneList: PaneInfo[] = []

  constructor(appService: any) {
    this.appService = appService
  }

  init(): void {
    if (typeof document === 'undefined') return
    this.injectStyles()
    log('PaneHeader initialized')
  }

  injectHeaders(tabs: any[], kind: string): void {
    setTimeout(() => this.doInject(tabs, kind), 300)
    setTimeout(() => this.doInject(tabs, kind), 800)
  }

  destroy(): void {
    for (const info of this.paneList) {
      try { info.headerEl.remove() } catch {}
      try { info.subscription?.unsubscribe() } catch {}
    }
    this.paneList = []
    document.getElementById(PANE_HEADER_CSS_ID)?.remove()
  }

  private doInject(tabs: any[], kind: string): void {
    for (const tab of tabs) {
      if (this.panes.has(tab)) continue
      const el = this.findPaneElement(tab)
      if (!el) continue

      const folderName = this.extractFolderName(tab)
      const header = this.createHeader(tab, kind, folderName)
      el.classList.add('agent-mux-has-pane-header')
      el.insertBefore(header, el.firstChild)

      let subscription: Subscription | null = null
      if (tab.destroyed$?.subscribe) {
        subscription = tab.destroyed$.subscribe(() => this.removeHeader(tab))
      }

      const info: PaneInfo = { tab, headerEl: header, kind, folderName, subscription }
      this.panes.set(tab, info)
      this.paneList.push(info)
    }
  }

  private removeHeader(tab: any): void {
    const info = this.panes.get(tab)
    if (!info) return
    try { info.headerEl.remove() } catch {}
    try { info.subscription?.unsubscribe() } catch {}
    this.paneList = this.paneList.filter(p => p.tab !== tab)
  }

  private findPaneElement(tab: any): HTMLElement | null {
    try {
      const el = tab.element?.nativeElement || tab.elementRef?.nativeElement
      if (el) return el

      const ref = tab.viewContainerEmbeddedRef
      if (ref?.rootNodes?.[0]) return ref.rootNodes[0] as HTMLElement
    } catch {}
    return null
  }

  private extractFolderName(tab: any): string {
    const cwd = tab.customTitle || tab.title || ''
    if (!cwd) return 'Terminal'
    const parts = cwd.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || parts[parts.length - 2] || cwd
  }

  private createHeader(tab: any, kind: string, folderName: string): HTMLElement {
    const header = document.createElement('div')
    header.className = 'agent-mux-pane-header'
    header.setAttribute('role', 'toolbar')
    header.setAttribute('aria-label', `${folderName} 窗格控制`)

    const badge = document.createElement('span')
    badge.className = `pane-badge ${kind}`
    badge.textContent = kind === 'codex' ? 'CX' : kind === 'claude' ? 'CC' : 'SH'
    header.appendChild(badge)

    const title = document.createElement('span')
    title.className = 'pane-title'
    title.title = folderName
    title.textContent = folderName
    header.appendChild(title)

    const maxBtn = document.createElement('button')
    maxBtn.className = 'pane-btn pane-btn-maximize'
    maxBtn.title = '最大化 (独立标签)'
    maxBtn.setAttribute('aria-label', '弹出为独立标签')
    maxBtn.textContent = '⬜'
    maxBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      this.popOutPane(tab)
    })
    header.appendChild(maxBtn)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'pane-btn pane-btn-close'
    closeBtn.title = '关闭此窗格'
    closeBtn.setAttribute('aria-label', '关闭窗格')
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      try { tab.destroy() } catch {}
    })
    header.appendChild(closeBtn)

    header.addEventListener('dblclick', () => this.popOutPane(tab))

    return header
  }

  private popOutPane(tab: any): void {
    try {
      const parent = tab.parent
      if (parent?.removeTab) {
        parent.removeTab(tab)
        if (this.appService.wrapAndAddTab) {
          this.appService.wrapAndAddTab(tab)
        }
        this.removeHeader(tab)
        log(`PaneHeader: popped out "${tab.customTitle || tab.title}"`)
      }
    } catch (e: any) {
      logError('PaneHeader.popOutPane', e)
    }
  }

  private injectStyles(): void {
    if (document.getElementById(PANE_HEADER_CSS_ID)) return
    const style = document.createElement('style')
    style.id = PANE_HEADER_CSS_ID
    style.textContent = PANE_HEADER_CSS
    document.head.appendChild(style)
  }
}
