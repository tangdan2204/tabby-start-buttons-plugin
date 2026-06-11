import { AgentMonitorService } from '../services/agent-monitor.service'
import { getConfig } from '../config'
import { log } from '../utils/logger'

const STYLE_ID = 'tabby-agent-mux-glow'

const GLOW_CSS = `
  @keyframes agent-pulse-blue {
    0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
    50% { box-shadow: 0 0 12px 3px rgba(59,130,246,0.6); }
  }
  @keyframes agent-pulse-red {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
    50% { box-shadow: 0 0 10px 2px rgba(239,68,68,0.5); }
  }
  @media (prefers-reduced-motion: reduce) {
    tab-header.agent-waiting,
    tab-header.agent-plan-review,
    tab-header.agent-error {
      animation: none !important;
    }
  }
  tab-header.agent-waiting {
    animation: agent-pulse-blue 1.5s infinite !important;
    border-top: 2px solid #3b82f6 !important;
  }
  tab-header.agent-plan-review {
    animation: agent-pulse-blue 2s infinite !important;
    border-top: 2px solid #8b5cf6 !important;
  }
  tab-header.agent-error {
    animation: agent-pulse-red 1.5s infinite !important;
    border-top: 2px solid #ef4444 !important;
  }
  tab-header.agent-complete {
    border-top: 2px solid #10b981 !important;
  }
  tab-header.agent-running {
    border-top: 2px solid #10b981 !important;
    opacity: 1 !important;
  }

  .agent-badge {
    position: fixed;
    top: 6px;
    right: 80px;
    background: #3b82f6;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    min-width: 18px;
    height: 18px;
    line-height: 18px;
    text-align: center;
    border-radius: 9px;
    padding: 0 5px;
    z-index: 10000;
    cursor: pointer;
    transition: transform 0.2s;
    font-family: system-ui, sans-serif;
    -webkit-app-region: no-drag;
  }
  .agent-badge:hover { transform: scale(1.15); }
  .agent-badge:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
  .agent-badge.hidden { display: none; }
`

export class NotificationGlow {
  private appService: any
  private agentMonitor: AgentMonitorService
  private badge: HTMLElement | null = null
  private observer: MutationObserver | null = null
  private subscriptions: any[] = []
  private tabHeaderMap = new WeakMap<any, HTMLElement>()
  private lastNotifiedTab: any = null
  private lastNotifyTime = 0
  private audioCtx: AudioContext | null = null
  private glowDebounce: any = null

  constructor(appService: any, agentMonitor: AgentMonitorService) {
    this.appService = appService
    this.agentMonitor = agentMonitor
  }

  init(): void {
    if (typeof document === 'undefined') return
    this.injectStyles()
    this.createBadge()
    this.subscribeToStates()
    this.watchTabHeaders()
    log('NotificationGlow initialized')
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    for (const sub of this.subscriptions) {
      try { sub.unsubscribe() } catch {}
    }
    this.subscriptions = []
    if (this.glowDebounce) { clearTimeout(this.glowDebounce); this.glowDebounce = null }
    document.getElementById(STYLE_ID)?.remove()
    this.badge?.remove()
    this.badge = null
    try { this.audioCtx?.close() } catch {}
    this.audioCtx = null
  }

  jumpToUnread(): void {
    const tab = this.agentMonitor.getNextUnreadTab()
    if (tab && this.appService.selectTab) {
      this.appService.selectTab(tab)
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = GLOW_CSS
    document.head.appendChild(style)
  }

  private createBadge(): void {
    this.badge = document.createElement('div')
    this.badge.className = 'agent-badge hidden'
    this.badge.title = '跳转到等待输入的 Agent (Ctrl+Shift+U)'
    this.badge.setAttribute('role', 'status')
    this.badge.setAttribute('aria-live', 'polite')
    this.badge.setAttribute('tabindex', '0')
    this.badge.addEventListener('click', () => this.jumpToUnread())
    this.badge.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.jumpToUnread() }
    })
    document.body.appendChild(this.badge)
  }

  private subscribeToStates(): void {
    this.subscriptions.push(
      this.agentMonitor.unreadCount$.subscribe(count => {
        if (!this.badge) return
        if (count > 0) {
          this.badge.textContent = String(count)
          this.badge.classList.remove('hidden')
          this.badge.setAttribute('aria-label', `${count} 个 Agent 需要关注`)
        } else {
          this.badge.classList.add('hidden')
        }
      })
    )

    this.subscriptions.push(
      this.agentMonitor.states$.subscribe(() => {
        this.scheduleGlowUpdate()
        this.checkOsNotification()
      })
    )

    if (this.appService.activeTabChange$?.subscribe) {
      this.subscriptions.push(
        this.appService.activeTabChange$.subscribe(() => {
          const tab = this.appService.activeTab
          if (tab) this.agentMonitor.markRead(tab)
        })
      )
    }
  }

  private checkOsNotification(): void {
    const config = getConfig()
    const activeTab = this.appService.activeTab
    const now = Date.now()

    for (const [tab, state] of this.agentMonitor.states$.value) {
      if (!state.unread) continue
      if (tab === activeTab) continue
      if (state.status !== 'waiting' && state.status !== 'plan-review' && state.status !== 'error') continue
      if (tab === this.lastNotifiedTab && now - this.lastNotifyTime < 15000) continue

      this.lastNotifiedTab = tab
      this.lastNotifyTime = now

      if (config.notifications.osBanner && typeof Notification !== 'undefined') {
        try {
          if (Notification.permission === 'granted') {
            const title = state.status === 'error' ? 'Agent 出错' : 'Agent 等待输入'
            const body = (tab.customTitle || tab.title || 'Terminal') + ': ' + (state.lastOutput || '').slice(0, 60)
            new Notification(title, { body })
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission()
          }
        } catch {}
      }

      if (config.notifications.sound) {
        this.playNotificationSound()
      }
      break
    }
  }

  private playNotificationSound(): void {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume()
      const osc = this.audioCtx.createOscillator()
      const gain = this.audioCtx.createGain()
      osc.connect(gain)
      gain.connect(this.audioCtx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.value = 0.1
      osc.start()
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3)
      osc.stop(this.audioCtx.currentTime + 0.3)
    } catch {}
  }

  private scheduleGlowUpdate(): void {
    if (this.glowDebounce) return
    this.glowDebounce = setTimeout(() => {
      this.glowDebounce = null
      this.updateTabGlows()
    }, 200)
  }

  private updateTabGlows(): void {
    const tabs: any[] = this.appService.tabs || []
    this.rebuildHeaderMap(tabs)

    for (const tab of tabs) {
      const header = this.tabHeaderMap.get(tab)
      if (!header) continue

      header.classList.remove('agent-waiting', 'agent-plan-review', 'agent-error', 'agent-complete', 'agent-running')

      const state = this.agentMonitor.getState(tab)
      if (!state || state.status === 'idle') continue
      header.classList.add(`agent-${state.status}`)
    }
  }

  private rebuildHeaderMap(tabs: any[]): void {
    const headers = document.querySelectorAll('tab-header')
    if (headers.length === 0) return

    for (let i = 0; i < tabs.length && i < headers.length; i++) {
      const tab = tabs[i]
      const header = headers[i] as HTMLElement

      const tabTitle = (tab.customTitle || tab.title || '').trim().toLowerCase()
      const headerTitle = (header.querySelector('.name')?.textContent || '').trim().toLowerCase()

      if (tabTitle && headerTitle && tabTitle === headerTitle) {
        this.tabHeaderMap.set(tab, header)
      } else {
        this.tabHeaderMap.set(tab, header)
      }
    }
  }

  private watchTabHeaders(): void {
    this.observer = new MutationObserver(() => {
      this.scheduleGlowUpdate()
    })
    const tabsContainer = document.querySelector('.tabs')?.parentElement
      || document.querySelector('tab-header')?.parentElement
    if (!tabsContainer || tabsContainer === document.body) return
    this.observer.observe(tabsContainer, { childList: true, subtree: false })
  }
}
