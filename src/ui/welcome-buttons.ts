import { log } from '../utils/logger'

const WELCOME_CSS_ID = 'agent-mux-welcome-css'
const CONTAINER_ID = 'agent-mux-welcome'

const WELCOME_CSS = `
  #${CONTAINER_ID} {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px 32px;
    margin: 20px auto;
    max-width: 420px;
    border: 1px solid var(--theme-border, #313244);
    border-radius: 12px;
    background: var(--theme-bg-more, rgba(30,30,46,0.5));
    font-family: system-ui, sans-serif;
    -webkit-app-region: no-drag;
  }
  #${CONTAINER_ID} .welcome-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--theme-fg, #e2e8f0);
  }
  #${CONTAINER_ID} .btn-row {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
  }
  #${CONTAINER_ID} .welcome-btn {
    padding: 10px 24px;
    border-radius: 6px;
    border: none;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s ease, transform 0.1s ease;
    min-height: 36px;
    min-width: 120px;
  }
  @media (prefers-reduced-motion: reduce) {
    #${CONTAINER_ID} .welcome-btn { transition: none; }
  }
  #${CONTAINER_ID} .welcome-btn:hover { opacity: 0.85; }
  #${CONTAINER_ID} .welcome-btn:active { transform: scale(0.97); }
  #${CONTAINER_ID} .welcome-btn:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }
  #${CONTAINER_ID} .welcome-btn.codex { background: #3b82f6; }
  #${CONTAINER_ID} .welcome-btn.claude { background: #f59e0b; }
  #${CONTAINER_ID} .welcome-btn.restore { background: #22c55e; }
`

export class WelcomeButtons {
  private commandProvider: any
  private injected = false
  private observer: MutationObserver | null = null
  private retryTimer: any = null
  private retryCount = 0
  private maxRetries = 8
  private navigationObserver: MutationObserver | null = null
  private navDebounce: any = null
  private totalReinjections = 0
  private maxTotalReinjections = 20

  constructor(commandProvider: any) {
    this.commandProvider = commandProvider
  }

  init(): void {
    if (typeof document === 'undefined') return
    this.injectStyles()

    if (this.tryInject()) {
      log('WelcomeButtons injected immediately')
    } else {
      this.startObserver()
      this.scheduleRetry()
    }

    this.watchNavigation()
    log('WelcomeButtons initialized with navigation watch')
  }

  destroy(): void {
    this.cleanup()
    if (this.navDebounce) { clearTimeout(this.navDebounce); this.navDebounce = null }
    this.navigationObserver?.disconnect()
    this.navigationObserver = null
    document.getElementById(CONTAINER_ID)?.remove()
    document.getElementById(WELCOME_CSS_ID)?.remove()
  }

  private watchNavigation(): void {
    this.navigationObserver = new MutationObserver(() => {
      if (this.navDebounce) return
      this.navDebounce = setTimeout(() => {
        this.navDebounce = null
        if (this.totalReinjections >= this.maxTotalReinjections) return
        if (!document.getElementById(CONTAINER_ID)) {
          this.injected = false
          this.retryCount = 0
          this.totalReinjections++
          if (!this.observer) this.startObserver()
          this.scheduleRetry()
        }
      }, 500)
    })
    const appRoot = document.querySelector('app-root') || document.body
    this.navigationObserver.observe(appRoot, { childList: true, subtree: false })
  }

  private startObserver(): void {
    if (this.observer) return
    this.observer = new MutationObserver((mutations) => {
      let hasRelevantChange = false
      for (const m of mutations) {
        if (m.addedNodes.length > 0) { hasRelevantChange = true; break }
      }
      if (!hasRelevantChange) return

      if (this.tryInject()) {
        this.stopInjectionAttempts()
        log('WelcomeButtons injected via MutationObserver')
      }
    })
    const target = document.querySelector('app-root') || document.body
    this.observer.observe(target, { childList: true, subtree: true })
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return
    if (this.retryCount >= this.maxRetries) {
      this.stopInjectionAttempts()
      log(`WelcomeButtons: gave up after ${this.maxRetries} retries`)
      return
    }

    const delay = Math.min(500 * Math.pow(1.5, this.retryCount), 5000)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.retryCount++
      if (this.tryInject()) {
        this.stopInjectionAttempts()
        log(`WelcomeButtons injected after ${this.retryCount} retries`)
      } else {
        this.scheduleRetry()
      }
    }, delay)
  }

  private stopInjectionAttempts(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  private cleanup(): void {
    this.stopInjectionAttempts()
  }

  private injectStyles(): void {
    if (document.getElementById(WELCOME_CSS_ID)) return
    const style = document.createElement('style')
    style.id = WELCOME_CSS_ID
    style.textContent = WELCOME_CSS
    document.head.appendChild(style)
  }

  private findTarget(): Element | null {
    if (document.getElementById(CONTAINER_ID)) return null

    const selectors = [
      'welcome-page .container.mt-3',
      'welcome-page .container',
      'welcome-page',
      'start-page .list-group',
      'start-page',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && !el.closest('.preload-logo')) return el
    }

    const formLine = document.querySelector('.form-line')
    if (formLine) {
      const container = formLine.closest('.container')
      if (container && !container.closest('.preload-logo')) return container
    }

    return null
  }

  private tryInject(): boolean {
    if (this.injected && document.getElementById(CONTAINER_ID)) return true
    if (document.getElementById(CONTAINER_ID)) { this.injected = true; return true }

    const target = this.findTarget()
    if (!target) return false

    const container = document.createElement('div')
    container.id = CONTAINER_ID
    container.setAttribute('role', 'group')
    container.setAttribute('aria-label', 'AI CLI 启动')

    const hasRecoverable = this.commandProvider.getSessionPersist?.()?.hasRecoverable?.()
    const restoreBtn = hasRecoverable
      ? '<button class="welcome-btn restore" data-action="restore" aria-label="恢复上次会话">↺ 恢复会话</button>'
      : ''

    container.innerHTML = `
      <div class="welcome-title">AI CLI 一键启动</div>
      <div class="btn-row">
        <button class="welcome-btn codex" data-action="codex" aria-label="启动 Codex CLI">启动 Codex</button>
        <button class="welcome-btn claude" data-action="claude" aria-label="启动 Claude Code">启动 Claude</button>
        ${restoreBtn}
      </div>
    `

    container.addEventListener('click', (e: Event) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement
      if (!btn) return
      const action = btn.dataset.action
      if (action === 'codex') this.commandProvider.launchKind?.('codex')
      else if (action === 'claude') this.commandProvider.launchKind?.('claude')
      else if (action === 'restore') this.commandProvider.restoreSessions?.()
    })

    let inserted = false
    const allBtns = target.querySelectorAll('button')
    for (let i = 0; i < allBtns.length; i++) {
      const text = allBtns[i].textContent || ''
      if (text.includes('关闭') || text.includes('Close')) {
        const wrapper = allBtns[i].closest('.text-center') || allBtns[i].parentElement
        if (wrapper && wrapper.parentElement === target) {
          target.insertBefore(container, wrapper)
          inserted = true
          break
        }
      }
    }
    if (!inserted) target.appendChild(container)

    this.injected = true
    return true
  }
}
