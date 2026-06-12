import { log, logError } from '../utils/logger'
import { EventBusService } from '../services/event-bus.service'

const BROWSER_PANEL_ID = 'agent-mux-browser'
const BROWSER_CSS_ID = 'agent-mux-browser-css'

const BROWSER_CSS = `
  #${BROWSER_PANEL_ID} {
    position: fixed;
    top: var(--agent-mux-tab-bar-h, 38px);
    right: 0;
    bottom: 0;
    width: var(--agent-mux-browser-width, 40%);
    min-width: 320px;
    background: var(--theme-bg, #1a1a2e);
    border-left: 1px solid var(--theme-border, #313244);
    z-index: 9990;
    display: flex;
    flex-direction: column;
    font-family: system-ui, sans-serif;
    transition: transform 0.2s ease;
    -webkit-app-region: no-drag;
  }
  @media (prefers-reduced-motion: reduce) {
    #${BROWSER_PANEL_ID} { transition: none; }
  }
  #${BROWSER_PANEL_ID}.hidden { transform: translateX(100%); pointer-events: none; }
  #${BROWSER_PANEL_ID} .browser-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--theme-bg-more, #16213e);
    border-bottom: 1px solid var(--theme-border, #313244);
    flex-shrink: 0;
  }
  #${BROWSER_PANEL_ID} .browser-toolbar button {
    background: none;
    border: none;
    color: var(--theme-fg-muted, #a6adc8);
    cursor: pointer;
    font-size: 14px;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
    min-width: 32px;
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #${BROWSER_PANEL_ID} .browser-toolbar button:hover { background: var(--theme-bg-hover, #313244); color: var(--theme-fg, #e2e8f0); }
  #${BROWSER_PANEL_ID} .browser-toolbar button:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
  #${BROWSER_PANEL_ID} .browser-url {
    flex: 1;
    background: var(--theme-bg, #1e1e2e);
    border: 1px solid var(--theme-border, #313244);
    border-radius: 4px;
    color: var(--theme-fg, #cdd6f4);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
    min-height: 32px;
  }
  #${BROWSER_PANEL_ID} .browser-url:focus { border-color: #6366f1; }
  #${BROWSER_PANEL_ID} .browser-content {
    flex: 1;
    position: relative;
  }
  #${BROWSER_PANEL_ID} .browser-content webview,
  #${BROWSER_PANEL_ID} .browser-content iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  #${BROWSER_PANEL_ID} .browser-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--theme-fg-muted, #6b7280);
    font-size: 13px;
    text-align: center;
    padding: 20px;
  }
  #${BROWSER_PANEL_ID} .resize-handle {
    position: absolute;
    left: -3px;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 1;
  }
  #${BROWSER_PANEL_ID} .resize-handle:hover { background: rgba(99,102,241,0.3); }
`

export class BrowserPanel {
  private panel: HTMLElement | null = null
  private urlInput: HTMLInputElement | null = null
  private contentArea: HTMLElement | null = null
  private webview: any = null
  private visible = false
  private currentUrl = ''
  private resizeCleanup: (() => void) | null = null
  private onVisibilityChange: (() => void) | null = null
  private eventBus: EventBusService | null = null

  constructor(eventBus?: EventBusService) {
    this.eventBus = eventBus || null
  }

  init(): void {
    if (typeof document === 'undefined') return
    this.resetStaleLayoutState()
    this.ensureWidthVar()
    this.injectStyles()
    log('BrowserPanel initialized (lazy)')
  }

  toggle(): void {
    if (!this.panel) this.createPanel()
    this.visible = !this.visible
    this.panel!.classList.toggle('hidden', !this.visible)
    this.notifyLayoutChange()
  }

  open(url?: string): void {
    if (!this.panel) this.createPanel()
    this.visible = true
    this.panel!.classList.remove('hidden')
    if (url) this.navigate(url)
    this.notifyLayoutChange()
  }

  close(): void {
    this.visible = false
    if (this.panel) this.panel.classList.add('hidden')
    this.notifyLayoutChange()
  }

  isVisible(): boolean {
    return this.visible
  }

  navigate(url: string): void {
    if (!url.startsWith('http')) url = 'http://' + url
    this.currentUrl = url
    if (this.urlInput) this.urlInput.value = url

    if (!this.webview) {
      this.createWebview()
    }

    if (this.webview) {
      if (this.webview.loadURL) {
        this.webview.loadURL(url)
      } else if (this.webview.src !== undefined) {
        this.webview.src = url
      }
    }
  }

  destroy(): void {
    this.resizeCleanup?.()
    this.resizeCleanup = null
    this.panel?.remove()
    this.panel = null
    document.getElementById(BROWSER_CSS_ID)?.remove()
    this.resetStaleLayoutState()
  }

  private notifyLayoutChange(): void {
    if (this.eventBus) {
      this.eventBus.emitLayoutChange({ browser: this.visible })
      return
    }
    window.dispatchEvent(new CustomEvent('agent-mux-layout-change', {
      detail: { browser: this.visible }
    }))
  }

  private ensureWidthVar(): void {
    const root = document.documentElement
    const current = root.style.getPropertyValue('--agent-mux-browser-width').trim()
    if (!current) root.style.setProperty('--agent-mux-browser-width', '40%')
  }

  private resetStaleLayoutState(): void {
    document.body.classList.remove('agent-mux-browser-active')
    const existing = document.getElementById(BROWSER_PANEL_ID) as HTMLElement | null
    if (existing) existing.classList.add('hidden')
    for (const node of Array.from(document.querySelectorAll('.tab-body, main-content'))) {
      const el = node as HTMLElement
      if (el.style && el.style.marginRight) el.style.marginRight = ''
    }
  }

  private injectStyles(): void {
    if (document.getElementById(BROWSER_CSS_ID)) return
    const style = document.createElement('style')
    style.id = BROWSER_CSS_ID
    style.textContent = BROWSER_CSS
    document.head.appendChild(style)
  }

  private createPanel(): void {
    if (document.getElementById(BROWSER_PANEL_ID)) {
      this.panel = document.getElementById(BROWSER_PANEL_ID)
      this.urlInput = this.panel!.querySelector('.browser-url')
      this.contentArea = this.panel!.querySelector('.browser-content')
      return
    }

    this.panel = document.createElement('div')
    this.panel.id = BROWSER_PANEL_ID
    this.panel.className = 'hidden'
    this.panel.setAttribute('role', 'complementary')
    this.panel.setAttribute('aria-label', '内嵌浏览器')

    this.panel.innerHTML = `
      <div class="resize-handle" aria-hidden="true"></div>
      <div class="browser-toolbar" role="toolbar" aria-label="浏览器工具栏">
        <button class="nav-back" title="后退" aria-label="后退">←</button>
        <button class="nav-forward" title="前进" aria-label="前进">→</button>
        <button class="nav-refresh" title="刷新" aria-label="刷新">↻</button>
        <input class="browser-url" type="url" placeholder="输入 URL..." aria-label="URL 地址栏" value="">
        <button class="nav-devtools" title="DevTools" aria-label="打开开发者工具">⚙</button>
        <button class="nav-close" title="关闭" aria-label="关闭浏览器面板">✕</button>
      </div>
      <div class="browser-content">
        <div class="browser-empty">输入 URL 或从侧边栏点击端口打开</div>
      </div>
    `

    document.body.appendChild(this.panel)
    this.ensureWidthVar()

    this.urlInput = this.panel.querySelector('.browser-url')
    this.contentArea = this.panel.querySelector('.browser-content')

    this.bindEvents()
  }

  private createWebview(): void {
    if (!this.contentArea) return
    const emptyMsg = this.contentArea.querySelector('.browser-empty')
    if (emptyMsg) emptyMsg.remove()

    if (this.webview) return

    if (this.isElectronWebviewAvailable()) {
      const wv = document.createElement('webview') as any
      wv.setAttribute('partition', 'persist:agent-mux-browser')
      wv.setAttribute('allowpopups', '')
      if (this.currentUrl) wv.src = this.currentUrl
      this.contentArea.appendChild(wv)
      this.webview = wv

      wv.addEventListener('did-navigate', (e: any) => {
        if (this.urlInput && e.url) this.urlInput.value = e.url
        this.currentUrl = e.url || this.currentUrl
      })
      wv.addEventListener('did-navigate-in-page', (e: any) => {
        if (this.urlInput && e.url) this.urlInput.value = e.url
      })
    } else {
      const iframe = document.createElement('iframe')
      iframe.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups')
      if (this.currentUrl) iframe.src = this.currentUrl
      this.contentArea.appendChild(iframe)
      this.webview = iframe
    }
  }

  private bindEvents(): void {
    if (!this.panel) return

    this.urlInput?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') this.navigate(this.urlInput!.value)
    })

    this.panel.querySelector('.nav-back')?.addEventListener('click', () => {
      if (this.webview?.goBack) this.webview.goBack()
      else if (this.webview?.contentWindow) try { this.webview.contentWindow.history.back() } catch {}
    })

    this.panel.querySelector('.nav-forward')?.addEventListener('click', () => {
      if (this.webview?.goForward) this.webview.goForward()
      else if (this.webview?.contentWindow) try { this.webview.contentWindow.history.forward() } catch {}
    })

    this.panel.querySelector('.nav-refresh')?.addEventListener('click', () => {
      if (this.webview?.reload) this.webview.reload()
      else if (this.webview?.contentWindow) try { this.webview.contentWindow.location.reload() } catch {}
    })

    this.panel.querySelector('.nav-devtools')?.addEventListener('click', () => {
      if (this.webview?.openDevTools) this.webview.openDevTools()
    })

    this.panel.querySelector('.nav-close')?.addEventListener('click', () => this.close())

    const handle = this.panel.querySelector('.resize-handle') as HTMLElement
    if (handle) this.setupResize(handle)
  }

  private setupResize(handle: HTMLElement): void {
    let startX = 0
    let startWidth = 0

    const onMove = (e: MouseEvent) => {
      const diff = startX - e.clientX
      const newWidth = startWidth + diff
      if (this.panel && newWidth >= 320 && newWidth <= window.innerWidth * 0.8) {
        this.panel.style.width = newWidth + 'px'
        document.documentElement.style.setProperty('--agent-mux-browser-width', newWidth + 'px')
      }
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }

    const onDown = (e: MouseEvent) => {
      startX = e.clientX
      startWidth = this.panel?.offsetWidth || 400
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      document.body.style.userSelect = 'none'
      e.preventDefault()
    }

    handle.addEventListener('mousedown', onDown)

    this.resizeCleanup = () => {
      handle.removeEventListener('mousedown', onDown)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }

  private isElectronWebviewAvailable(): boolean {
    try {
      const wv = document.createElement('webview')
      return 'loadURL' in wv || typeof (wv as any).loadURL === 'function'
    } catch {
      return false
    }
  }
}
