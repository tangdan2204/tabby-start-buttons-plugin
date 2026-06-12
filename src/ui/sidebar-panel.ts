import * as fs from 'fs'
import * as path from 'path'
import { Subscription } from 'rxjs'
import { AgentMonitorService, AgentState } from '../services/agent-monitor.service'
import { TabMetadataService, TabMetadata } from '../services/tab-metadata.service'
import { LaunchService } from '../services/launch.service'
import { SessionPersistService } from '../services/session-persist.service'
import { EventBusService } from '../services/event-bus.service'
import { log, logError } from '../utils/logger'

const PANEL_ID = 'agent-mux-sidebar'
const PANEL_CSS_ID = 'agent-mux-sidebar-css'

function getTabBarHeight(): string {
  const tabBar = document.querySelector('.tabs') as HTMLElement
  return tabBar ? `${tabBar.offsetHeight}px` : '38px'
}

const SIDEBAR_CSS = `
  #${PANEL_ID} {
    position: fixed;
    top: var(--agent-mux-tab-bar-h, 38px);
    left: 0;
    bottom: 0;
    width: 260px;
    max-width: 80vw;
    background: var(--theme-bg-more, #1e1e2e);
    border-right: 1px solid var(--theme-border, #313244);
    z-index: 9990;
    overflow-y: auto;
    font-family: system-ui, sans-serif;
    font-size: 12px;
    color: var(--theme-fg, #cdd6f4);
    padding: 8px 0;
    transition: transform 0.2s ease;
    -webkit-app-region: no-drag;
  }
  @media (prefers-reduced-motion: reduce) {
    #${PANEL_ID} { transition: none; }
  }
  #${PANEL_ID}.hidden { transform: translateX(-100%); pointer-events: none; }
  #${PANEL_ID} .panel-header {
    padding: 6px 12px;
    font-weight: 700;
    font-size: 11px;
    color: var(--theme-fg-muted, #a6adc8);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #${PANEL_ID} .panel-header button {
    background: none;
    border: none;
    color: var(--theme-fg-muted, #a6adc8);
    cursor: pointer;
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 3px;
    min-height: 24px;
  }
  #${PANEL_ID} .panel-header button:hover { background: var(--theme-bg-hover, #313244); }
  #${PANEL_ID} .panel-header button:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }

  #${PANEL_ID} .agent-item {
    padding: 6px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-left: 3px solid transparent;
    min-height: 32px;
    justify-content: center;
  }
  #${PANEL_ID} .agent-item:hover { background: var(--theme-bg-hover, #313244); }
  #${PANEL_ID} .agent-item:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
  #${PANEL_ID} .agent-item.active { border-left-color: rgb(215, 119, 87); background: rgba(215, 119, 87, 0.12); }
  #${PANEL_ID} .agent-item .agent-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  #${PANEL_ID} .agent-item .status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  }
  #${PANEL_ID} .agent-item .status-dot.running { background: #10b981; }
  #${PANEL_ID} .agent-item .status-dot.waiting { background: #3b82f6; animation: dot-pulse 1.5s infinite; }
  #${PANEL_ID} .agent-item .status-dot.plan-review { background: #8b5cf6; animation: dot-pulse 2s infinite; }
  #${PANEL_ID} .agent-item .status-dot.error { background: #ef4444; }
  #${PANEL_ID} .agent-item .status-dot.complete { background: #10b981; }
  #${PANEL_ID} .agent-item .status-dot.idle { background: #6b7280; }
  @keyframes dot-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @media (prefers-reduced-motion: reduce) {
    #${PANEL_ID} .agent-item .status-dot { animation: none !important; }
  }

  #${PANEL_ID} .agent-item .agent-name {
    font-weight: 600; font-size: 12px; color: var(--theme-fg, #e2e8f0);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    flex: 1;
  }
  #${PANEL_ID} .agent-item .agent-meta {
    font-size: 10px; color: var(--theme-fg-muted, #6b7280); padding-left: 14px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #${PANEL_ID} .agent-item .agent-output {
    font-size: 10px; color: #9ca3af; padding-left: 14px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-style: italic;
  }

  #${PANEL_ID} .section-divider {
    height: 1px; background: var(--theme-border, #313244); margin: 8px 12px;
  }
  #${PANEL_ID} .dir-item {
    padding: 4px 12px;
    cursor: pointer;
    display: flex; align-items: center; gap: 6px;
    font-size: 11px;
    min-height: 32px;
  }
  #${PANEL_ID} .dir-item:hover { background: var(--theme-bg-hover, #313244); }
  #${PANEL_ID} .dir-item:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
  #${PANEL_ID} .dir-item .dir-icon { color: #f59e0b; }
  #${PANEL_ID} .dir-item .dir-name { color: var(--theme-fg, #e2e8f0); }

  #${PANEL_ID} .history-item {
    padding: 4px 12px;
    cursor: pointer;
    display: flex; align-items: center; gap: 6px;
    font-size: 11px;
    min-height: 32px;
  }
  #${PANEL_ID} .history-item:hover { background: var(--theme-bg-hover, #313244); }
  #${PANEL_ID} .history-item:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
  #${PANEL_ID} .history-item .kind-badge {
    font-size: 9px; font-weight: 700; padding: 1px 4px;
    border-radius: 3px;
  }
  #${PANEL_ID} .history-item .kind-badge.codex { background: #0ea5e933; color: #38bdf8; }
  #${PANEL_ID} .history-item .kind-badge.claude { background: #f59e0b33; color: #f59e0b; }

  @media (max-width: 768px) {
    #${PANEL_ID} { width: 200px; }
  }
`

export class SidebarPanel {
  private appService: any
  private agentMonitor: AgentMonitorService
  private tabMetadata: TabMetadataService | null = null
  private launchService: LaunchService
  private sessionPersist: SessionPersistService
  private eventBus: EventBusService
  private panel: HTMLElement | null = null
  private agentListEl: HTMLElement | null = null
  private historyEl: HTMLElement | null = null
  private visible = false
  private rootDir: string = ''
  private mode: 'agents' | 'files' = 'agents'
  private subscriptions: Subscription[] = []
  private renderDebounce: any = null
  private cachedDirEntries: string[] | null = null
  private dirLoadGeneration = 0

  constructor(
    appService: any,
    agentMonitor: AgentMonitorService,
    tabMetadata: TabMetadataService,
    launchService: LaunchService,
    sessionPersist: SessionPersistService,
    eventBus: EventBusService,
  ) {
    this.appService = appService
    this.agentMonitor = agentMonitor
    this.tabMetadata = tabMetadata
    this.launchService = launchService
    this.sessionPersist = sessionPersist
    this.eventBus = eventBus
    this.rootDir = launchService.getLastProjectCwd()
  }

  init(): void {
    if (typeof document === 'undefined') return
    this.injectStyles()
    this.syncTabBarHeight()
    this.createPanel()
    this.bindDelegatedEvents()
    this.subscribeToUpdates()
    this.adjustMainContent()
    log('SidebarPanel initialized')
  }

  toggle(): void {
    this.visible = !this.visible
    if (this.panel) this.panel.classList.toggle('hidden', !this.visible)
    this.adjustMainContent()
    this.eventBus.emitLayoutChange({ sidebar: this.visible })
  }

  isVisible(): boolean { return this.visible }

  updateRoot(dir: string): void {
    this.rootDir = dir
    this.cachedDirEntries = null
    this.dirLoadGeneration++
    this.scheduleRender()
  }

  destroy(): void {
    for (const sub of this.subscriptions) {
      try { sub.unsubscribe() } catch {}
    }
    this.subscriptions = []
    if (this.renderDebounce) { clearTimeout(this.renderDebounce); this.renderDebounce = null }
    this.panel?.remove()
    document.getElementById(PANEL_CSS_ID)?.remove()
    document.body.classList.remove('agent-mux-sidebar-active')
  }

  private syncTabBarHeight(): void {
    const h = getTabBarHeight()
    document.documentElement.style.setProperty('--agent-mux-tab-bar-h', h)
  }

  private injectStyles(): void {
    if (document.getElementById(PANEL_CSS_ID)) return
    const style = document.createElement('style')
    style.id = PANEL_CSS_ID
    style.textContent = SIDEBAR_CSS
    document.head.appendChild(style)
  }

  private createPanel(): void {
    if (document.getElementById(PANEL_ID)) {
      this.panel = document.getElementById(PANEL_ID)
      return
    }
    this.panel = document.createElement('div')
    this.panel.id = PANEL_ID
    this.panel.classList.add('hidden')
    this.panel.setAttribute('role', 'complementary')
    this.panel.setAttribute('aria-label', 'Agent 面板')

    this.panel.innerHTML = `
      <div class="panel-header">
        <span>Agent Mux</span>
        <div>
          <button data-mode="agents" title="Agent 面板" aria-label="显示 Agent 列表">AG</button>
          <button data-mode="files" title="文件" aria-label="显示文件列表">F</button>
        </div>
      </div>
      <div class="agent-list-container"></div>
      <div class="section-divider"></div>
      <div class="history-container"></div>
    `

    document.body.appendChild(this.panel)
    this.agentListEl = this.panel.querySelector('.agent-list-container')
    this.historyEl = this.panel.querySelector('.history-container')
    this.scheduleRender()
  }

  private bindDelegatedEvents(): void {
    if (!this.panel) return

    this.panel.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement

      const portBtn = target.closest('.port-open-btn') as HTMLElement
      if (portBtn) {
        e.stopPropagation()
        const port = portBtn.dataset.port
        if (port) this.eventBus.emitPortClick({ port: parseInt(port, 10) })
        return
      }

      const agentItem = target.closest('.agent-item') as HTMLElement
      if (agentItem) {
        const idx = parseInt(agentItem.dataset.tabIndex || '0', 10)
        const tabs = this.appService?.tabs || []
        if (tabs[idx] && this.appService.selectTab) {
          this.appService.selectTab(tabs[idx])
        }
        return
      }

      const dirItem = target.closest('.dir-item') as HTMLElement
      if (dirItem) {
        const dir = dirItem.dataset.dir || ''
        if (dir) this.launchService.launchInDir('claude', dir)
        return
      }

      const historyItem = target.closest('.history-item') as HTMLElement
      if (historyItem) {
        const kind = historyItem.dataset.kind || 'claude'
        const cwd = historyItem.dataset.cwd || ''
        if (cwd) this.launchService.launchInDir(kind, cwd)
        return
      }

      const modeBtn = target.closest('[data-mode]') as HTMLElement
      if (modeBtn) {
        this.mode = (modeBtn.dataset.mode as any) || 'agents'
        this.scheduleRender()
        return
      }

      const restoreBtn = target.closest('[data-action="restore-all"]') as HTMLElement
      if (restoreBtn) {
        this.eventBus.emitLaunchRequest({ kind: 'shell' })
        return
      }
    })
  }

  private subscribeToUpdates(): void {
    this.subscriptions.push(
      this.agentMonitor.states$.subscribe(() => this.scheduleRender()) as any
    )
    if (this.appService.tabsChanged$?.subscribe) {
      this.subscriptions.push(
        this.appService.tabsChanged$.subscribe(() => this.scheduleRender()) as any
      )
    }
    if (this.appService.activeTabChange$?.subscribe) {
      this.subscriptions.push(
        this.appService.activeTabChange$.subscribe(() => this.scheduleRender()) as any
      )
    }
  }

  private scheduleRender(): void {
    if (this.renderDebounce) return
    if (!this.visible) return
    this.renderDebounce = setTimeout(() => {
      this.renderDebounce = null
      if (this.visible) this.render()
    }, 300)
  }

  private render(): void {
    if (!this.agentListEl || !this.historyEl) return

    if (this.mode === 'agents') {
      this.agentListEl.innerHTML = this.renderAgentList()
    } else {
      this.agentListEl.innerHTML = this.renderFileList()
    }
    this.historyEl.innerHTML = this.renderHistory()
  }

  private renderAgentList(): string {
    const tabs = this.appService?.tabs || []
    const activeTab = this.appService?.activeTab
    if (tabs.length === 0) {
      return '<div style="padding:12px;color:var(--theme-fg-muted,#6b7280);font-size:11px;">无打开标签</div>'
    }

    const items: string[] = []
    for (let idx = 0; idx < tabs.length; idx++) {
      const tab = tabs[idx]
      if (tab.addTab && !tab.customTitle) continue

      const state = this.agentMonitor.getState(tab)
      const status = state?.status || 'idle'
      const isActive = tab === activeTab
      const name = tab.customTitle || tab.title || 'Terminal'
      const output = state?.lastOutput || ''

      let metaLine = ''
      if (this.tabMetadata) {
        const meta = this.tabMetadata.get(tab)
        if (meta) {
          const parts: string[] = []
          if (meta.gitBranch) parts.push(`⎇ ${meta.gitBranch}`)
          if (meta.cwd) parts.push(meta.cwd.length > 30 ? '...' + meta.cwd.slice(-27) : meta.cwd)
          if (meta.ports.length > 0) parts.push(meta.ports.map(p => `:${p}`).join(' '))
          metaLine = parts.join(' | ')
        }
      }

      let portButtons = ''
      const detectedPorts = state?.detectedPorts || []
      if (detectedPorts.length > 0) {
        portButtons = detectedPorts.map(p =>
          `<span class="port-open-btn" data-port="${p}" role="button" tabindex="0" aria-label="在浏览器打开端口 ${p}" style="font-size:9px;background:#06b6d433;color:#06b6d4;padding:1px 4px;border-radius:3px;cursor:pointer;margin-left:4px;">:${p} ↗</span>`
        ).join('')
      }

      items.push(`<div class="agent-item${isActive ? ' active' : ''}" data-tab-index="${idx}" role="button" tabindex="0" aria-label="${this.escapeHtml(name)} - ${status}">
        <div class="agent-top">
          <div class="status-dot ${status}" aria-hidden="true"></div>
          <div class="agent-name">${this.escapeHtml(name)}${portButtons}</div>
        </div>
        ${metaLine ? `<div class="agent-meta">${this.escapeHtml(metaLine)}</div>` : ''}
        ${output ? `<div class="agent-output">${this.escapeHtml(output)}</div>` : ''}
      </div>`)
    }

    return items.length > 0 ? items.join('') :
      '<div style="padding:12px;color:var(--theme-fg-muted,#6b7280);font-size:11px;">无打开标签</div>'
  }

  private renderFileList(): string {
    if (!this.rootDir) return '<div style="padding:12px;color:var(--theme-fg-muted,#6b7280);font-size:11px;">未选择目录</div>'

    if (!this.cachedDirEntries) {
      this.loadDirEntriesAsync()
      return '<div style="padding:12px;color:var(--theme-fg-muted,#6b7280);font-size:11px;">加载中...</div>'
    }

    return this.cachedDirEntries.map(d => `<div class="dir-item" data-dir="${this.escapeHtml(path.join(this.rootDir, d))}" role="button" tabindex="0" aria-label="在 ${d} 启动 Claude">
      <span class="dir-icon" aria-hidden="true">📁</span>
      <span class="dir-name">${this.escapeHtml(d)}</span>
    </div>`).join('')
  }

  private loadDirEntriesAsync(): void {
    const gen = ++this.dirLoadGeneration
    fs.readdir(this.rootDir, (err, entries) => {
      if (gen !== this.dirLoadGeneration) return
      if (err) { this.cachedDirEntries = []; return }
      const filtered = entries.filter(e => !e.startsWith('.') && e !== 'node_modules').slice(0, 30)
      const dirs: string[] = []
      let pending = filtered.length
      if (pending === 0) { this.cachedDirEntries = []; this.scheduleRender(); return }
      for (const e of filtered) {
        fs.stat(path.join(this.rootDir, e), (err2, stat) => {
          if (gen !== this.dirLoadGeneration) return
          if (!err2 && stat.isDirectory()) dirs.push(e)
          if (--pending === 0) {
            this.cachedDirEntries = dirs.sort()
            this.scheduleRender()
          }
        })
      }
    })
  }

  private renderHistory(): string {
    const history = this.launchService.getHistory()

    let recoverHtml = ''
    if (this.sessionPersist.hasRecoverable()) {
      const sessions = this.sessionPersist.getRecoverable()
      recoverHtml = `<div class="panel-header"><span>恢复会话 (${sessions.length})</span><button data-action="restore-all" aria-label="恢复所有会话" style="font-size:10px;">全部恢复</button></div>`
      recoverHtml += sessions.map((s: any) => {
        const name = s.cwd.split(/[\\/]/).pop() || s.cwd
        return `<div class="history-item" data-kind="${s.kind}" data-cwd="${this.escapeHtml(s.cwd)}" role="button" tabindex="0" aria-label="恢复 ${s.kind} 在 ${name}">
          <span class="kind-badge ${s.kind}">${s.kind === 'codex' ? 'CX' : 'CC'}</span>
          <span>${this.escapeHtml(name)}</span>
          <span style="margin-left:auto;font-size:9px;color:#6b7280;">↺</span>
        </div>`
      }).join('')
      recoverHtml += '<div class="section-divider"></div>'
    }

    if (history.length === 0 && !recoverHtml) return ''

    let historyHtml = ''
    if (history.length > 0) {
      const items = history.slice(0, 8).map((h: any) => {
        const name = path.basename(h.cwd)
        return `<div class="history-item" data-kind="${h.kind}" data-cwd="${this.escapeHtml(h.cwd)}" role="button" tabindex="0" aria-label="重新启动 ${h.kind} 在 ${name}">
          <span class="kind-badge ${h.kind}">${h.kind === 'codex' ? 'CX' : 'CC'}</span>
          <span>${this.escapeHtml(name)}</span>
        </div>`
      })
      historyHtml = `<div class="panel-header"><span>最近</span></div>${items.join('')}`
    }

    return recoverHtml + historyHtml
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  private adjustMainContent(): void {
    document.body.classList.toggle('agent-mux-sidebar-active', this.visible)
  }
}
