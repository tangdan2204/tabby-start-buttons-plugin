import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as path from 'path'
import { Subscription } from 'rxjs'
import { CommandProvider, CommandLocation, ProfilesService, NotificationsService, AppService } from 'tabby-core'
import { log, logError } from '../utils/logger'
import { getConfig, makeCodexProfile, makeClaudeProfile, makeShellProfile } from '../config'
import { AgentMonitorService } from '../services/agent-monitor.service'
import { TabMetadataService } from '../services/tab-metadata.service'
import { TeamsService } from '../services/teams.service'
import { SessionPersistService } from '../services/session-persist.service'
import { ScrollbackCacheService } from '../services/scrollback-cache.service'
import { NotificationGlow } from '../ui/notification-glow'
import { SidebarPanel } from '../ui/sidebar-panel'
import { WelcomeButtons } from '../ui/welcome-buttons'
import { TabProtection } from '../ui/tab-protection'
import { BrowserPanel } from '../ui/browser-panel'
import { ProcessKeepAlive } from '../ui/process-keepalive'

const HISTORY_DIR = path.join(process.env.APPDATA || process.env.HOME || __dirname, 'tabby-agent-mux')
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json')
const HISTORY_MAX = 20

function ensureHistoryDir(): void {
  try { if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true }) } catch {}
}

function loadHistory(): any[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
  } catch {}
  return []
}

function saveHistoryAsync(kind: string, cwd: string): void {
  try {
    ensureHistoryDir()
    let list = loadHistory()
    list = list.filter((item: any) => !(item.kind === kind && item.cwd === cwd))
    list.unshift({ kind, cwd, ts: Date.now() })
    if (list.length > HISTORY_MAX) list = list.slice(0, HISTORY_MAX)
    fs.writeFile(HISTORY_FILE, JSON.stringify(list, null, 2), 'utf-8', () => {})
  } catch {}
}

@Injectable()
export class AgentMuxCommandProvider extends CommandProvider {
  private lastProjectCwd: string

  private notificationGlow: NotificationGlow
  private sidebarPanel: SidebarPanel
  private welcomeButtons: WelcomeButtons
  private tabProtection: TabProtection
  private browserPanel: BrowserPanel
  private processKeepAlive: ProcessKeepAlive

  private subscriptions: Subscription[] = []
  private monitoredTabs = new WeakSet<any>()
  private layoutHandler: ((e: Event) => void) | null = null

  constructor(
    private profilesService: ProfilesService,
    private notifications: NotificationsService,
    private appService: AppService,
    private agentMonitor: AgentMonitorService,
    private tabMetadata: TabMetadataService,
    private teamsService: TeamsService,
    private sessionPersist: SessionPersistService,
    private scrollbackCache: ScrollbackCacheService,
  ) {
    super()

    const config = getConfig()
    this.lastProjectCwd = config.defaultProjectDir

    this.notificationGlow = new NotificationGlow(appService, this.agentMonitor)
    this.sidebarPanel = new SidebarPanel(this, appService, this.agentMonitor, this.tabMetadata)
    this.welcomeButtons = new WelcomeButtons(this)
    this.tabProtection = new TabProtection(appService, notifications)
    this.browserPanel = new BrowserPanel()
    this.processKeepAlive = new ProcessKeepAlive()

    this.sidebarPanel.onPortClick = (port: number) => {
      this.browserPanel.open(`http://localhost:${port}`)
    }

    log('AgentMuxCommandProvider constructed')
    this.deferredInit()
  }

  private deferredInit(): void {
    setTimeout(() => {
      this.initAll()
      this.bindHotkeys()
      this.bindLayoutCoordination()
      this.monitorAllTabs()
      this.patchRightClickPaste()
    }, 0)
  }

  private initAll(): void {
    try { this.notificationGlow.init() } catch (e: any) { logError('NotificationGlow.init', e) }
    try { this.sidebarPanel.init() } catch (e: any) { logError('SidebarPanel.init', e) }
    try { this.welcomeButtons.init() } catch (e: any) { logError('WelcomeButtons.init', e) }
    try { this.tabProtection.init() } catch (e: any) { logError('TabProtection.init', e) }
    try { this.browserPanel.init() } catch (e: any) { logError('BrowserPanel.init', e) }
    this.autoRestoreIfNeeded()
  }

  private bindHotkeys(): void {
    try {
      const hotkeys = (this.appService as any).hotkeys
      if (!hotkeys?.hotkey$?.subscribe) return
      const sub = hotkeys.hotkey$.subscribe((id: string) => {
        switch (id) {
          case 'agent-mux:jump-unread':
            this.notificationGlow.jumpToUnread()
            break
          case 'agent-mux:mark-all-read':
            this.agentMonitor.markAllRead()
            break
          case 'agent-mux:toggle-sidebar':
            this.sidebarPanel.toggle()
            break
        }
      })
      this.subscriptions.push(sub)
    } catch {}
  }

  private bindLayoutCoordination(): void {
    this.layoutHandler = ((e: CustomEvent) => {
      const { sidebar, browser } = e.detail || {}
      if (sidebar === true && this.browserPanel.isVisible()) {
        this.browserPanel.close()
      }
      if (browser === true && this.sidebarPanel.isVisible()) {
        this.sidebarPanel.toggle()
      }
    }) as EventListener
    window.addEventListener('agent-mux-layout-change', this.layoutHandler)
  }

  private monitorAllTabs(): void {
    const tabSubs = new WeakMap<any, Subscription[]>()

    const attachMonitor = (tab: any) => {
      if (!tab || this.monitoredTabs.has(tab)) return
      this.monitoredTabs.add(tab)
      const perTab: Subscription[] = []
      tabSubs.set(tab, perTab)

      const tryAttachOutput = () => {
        if (tab.destroyed) return
        if (tab.session?.output$?.subscribe) {
          const sub = tab.session.output$.subscribe((data: any) => {
            const text = typeof data === 'string' ? data : data?.toString?.() || ''
            if (text) this.agentMonitor.updateOutput(tab, text)
          })
          perTab.push(sub)
          this.tabMetadata.track(tab)
        }
      }

      tryAttachOutput()
      if (!tab.session?.output$) {
        let retries = 0
        const iv = setInterval(() => {
          retries++
          if (tab.destroyed || retries > 10) { clearInterval(iv); return }
          if (tab.session?.output$) { clearInterval(iv); tryAttachOutput() }
        }, 500)
      }

      if (tab.destroyed$?.subscribe) {
        const sub = tab.destroyed$.subscribe(() => {
          this.agentMonitor.removeTab(tab)
          const subs = tabSubs.get(tab)
          if (subs) {
            for (const s of subs) { try { s.unsubscribe() } catch {} }
            tabSubs.delete(tab)
          }
        })
        perTab.push(sub)
      }
    }

    const existingTabs = (this.appService as any).tabs || []
    for (const tab of existingTabs) attachMonitor(tab)

    if ((this.appService as any).tabOpened$?.subscribe) {
      const sub = (this.appService as any).tabOpened$.subscribe((tab: any) => {
        attachMonitor(tab)
      })
      this.subscriptions.push(sub)
    }

    if ((this.appService as any).tabsChanged$?.subscribe) {
      const sub = (this.appService as any).tabsChanged$.subscribe(() => {
        const tabs = (this.appService as any).tabs || []
        for (const tab of tabs) attachMonitor(tab)
      })
      this.subscriptions.push(sub)
    }

    log('monitorAllTabs: auto-monitoring enabled')
  }

  private patchRightClickPaste(): void {
    let lastRightClickTime = 0
    let lastPasteContent = ''
    let lastPasteTime = 0

    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 2) lastRightClickTime = Date.now()
    }, true)

    document.addEventListener('paste', (e: ClipboardEvent) => {
      const elapsed = Date.now() - lastRightClickTime
      if (elapsed < 100) {
        const target = e.target as HTMLElement
        const isXterm = target.closest('.xterm') || target.closest('.terminal-wrapper') || target.closest('xterm-screen')
        if (isXterm) {
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }
    }, true)

    const patchSessionWrite = (tab: any) => {
      if (!tab?.session?.write || tab.session.__pasteGuardPatched) return
      const originalWrite = tab.session.write.bind(tab.session)
      tab.session.__pasteGuardPatched = true
      tab.session.write = (data: any) => {
        const now = Date.now()
        const text = typeof data === 'string' ? data : data?.toString?.() || ''
        if (
          now - lastRightClickTime < 300 &&
          text.length > 1 &&
          text === lastPasteContent &&
          now - lastPasteTime < 150
        ) {
          log('patchRightClickPaste: blocked duplicate write')
          return
        }
        if (now - lastRightClickTime < 300 && text.length > 1) {
          lastPasteContent = text
          lastPasteTime = now
        }
        originalWrite(data)
      }
    }

    const tryPatchActive = () => {
      const tab = (this.appService as any).activeTab
      if (tab?.session) patchSessionWrite(tab)
    }

    if ((this.appService as any).activeTabChange$?.subscribe) {
      this.subscriptions.push(
        (this.appService as any).activeTabChange$.subscribe(() => {
          setTimeout(tryPatchActive, 100)
        })
      )
    }
    if ((this.appService as any).tabOpened$?.subscribe) {
      this.subscriptions.push(
        (this.appService as any).tabOpened$.subscribe((tab: any) => {
          const waitSession = () => {
            if (tab?.session) patchSessionWrite(tab)
            else if (!tab?.destroyed) setTimeout(waitSession, 300)
          }
          setTimeout(waitSession, 200)
        })
      )
    }
    setTimeout(tryPatchActive, 500)

    log('patchRightClickPaste: session-level dedup guard active')
  }

  async provide(): Promise<any[]> {
    return [
      {
        id: 'tabby-agent-mux:codex',
        label: '启动 Codex CLI',
        icon: '<span style="font-weight:700;color:#38bdf8">CX</span>',
        sublabel: '选择工程目录后启动 Codex',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.launchKind('codex'),
      },
      {
        id: 'tabby-agent-mux:claude',
        label: '启动 Claude Code',
        icon: '<span style="font-weight:700;color:#f59e0b">CC</span>',
        sublabel: '选择工程目录后启动 Claude Code',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.launchKind('claude'),
      },
      {
        id: 'tabby-agent-mux:toggle-sidebar',
        label: '切换 Agent 面板',
        icon: '<span style="font-weight:700;color:#10b981">AG</span>',
        sublabel: '显示/隐藏左侧 Agent 面板',
        locations: [CommandLocation.LeftToolbar],
        run: async () => this.sidebarPanel.toggle(),
      },
      {
        id: 'tabby-agent-mux:toggle-lock',
        label: '锁定/解锁当前标签',
        icon: '<span style="font-weight:700;color:#f43f5e">🔒</span>',
        sublabel: '切换当前标签的关闭保护',
        locations: [CommandLocation.LeftToolbar],
        run: async () => {
          const tab = (this.appService as any).activeTab
          if (!tab) return
          if (this.tabProtection.isProtected(tab)) {
            this.tabProtection.unprotect(tab)
            this.notifications.info('标签已解锁')
          } else {
            this.tabProtection.protect(tab)
            this.notifications.info('标签已锁定')
          }
        },
      },
      {
        id: 'tabby-agent-mux:jump-unread',
        label: '跳转到等待中的 Agent',
        icon: '<span style="font-weight:700;color:#3b82f6">!</span>',
        sublabel: '跳到下一个需要输入的 Agent Tab',
        locations: [CommandLocation.LeftToolbar],
        run: async () => this.notificationGlow.jumpToUnread(),
      },
      {
        id: 'tabby-agent-mux:teams',
        label: '启动 Agent Team',
        icon: '<span style="font-weight:700;color:#a78bfa">TM</span>',
        sublabel: '多 Agent 并排会话',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.launchTeam(),
      },
      {
        id: 'tabby-agent-mux:browser',
        label: '打开浏览器面板',
        icon: '<span style="font-weight:700;color:#06b6d4">WB</span>',
        sublabel: '内嵌浏览器 (localhost)',
        locations: [CommandLocation.LeftToolbar],
        run: async () => this.browserPanel.toggle(),
      },
      {
        id: 'tabby-agent-mux:restore-sessions',
        label: '恢复上次会话',
        icon: '<span style="font-weight:700;color:#22c55e">↺</span>',
        sublabel: '恢复意外关闭的 Agent 会话',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.restoreSessions(),
      },
    ]
  }

  async launch(profile: any): Promise<any> {
    try {
      log('launch: ' + profile.name)
      const tab = await this.profilesService.openNewTabForProfile(profile)
      if (!tab) { log('launch FAILED: tab is null'); return null }

      const cwd = profile.options?.cwd || ''
      const title = String(profile.name || path.basename(cwd) || 'Terminal').trim()
      const profileKind = profile.id?.includes('codex') ? 'codex' : profile.id?.includes('claude') ? 'claude' : ''

      const forceTitle = () => {
        if (!tab || tab.destroyed) return
        tab.customTitle = title
        tab.disableDynamicTitle = true
        if (tab.inputs) {
          tab.inputs.customTitle = title
          tab.inputs.disableDynamicTitle = true
        }
      }
      forceTitle()
      this.tabProtection.protect(tab)

      let titleInterval: any = null
      titleInterval = setInterval(() => {
        if (!tab || tab.destroyed) { clearInterval(titleInterval); return }
        forceTitle()
      }, 1000)
      setTimeout(() => clearInterval(titleInterval), 3000)

      if (tab.titleChange$?.subscribe) {
        const titleSub = tab.titleChange$.subscribe(() => { if (!tab.destroyed) forceTitle() })
        if (tab.destroyed$?.subscribe) {
          tab.destroyed$.subscribe(() => { try { titleSub.unsubscribe() } catch {} })
        }
      }

      if (profileKind) {
        this.sessionPersist.save(profileKind, cwd, title)

        this.processKeepAlive.watch(tab, profileKind, cwd, () => {
          this.launchInDir(profileKind, cwd)
        })

        this.attachScrollbackCapture(tab, profileKind, cwd)
      }

      if (tab.destroyed$?.subscribe) {
        const sub = tab.destroyed$.subscribe(() => {
          clearInterval(titleInterval)
          if (profileKind) {
            this.processKeepAlive.unwatch(tab)
            this.scrollbackCache.flushAll()
            this.sessionPersist.remove(profileKind, cwd)
          }
        })
        this.subscriptions.push(sub)
      }

      log(`Tab launched: ${title}`)
      return tab
    } catch (e: any) {
      logError('launch', e)
      this.notifications.error('启动失败: ' + (e.message || e))
      return null
    }
  }

  chooseProjectDirectory(): string | null {
    let electronRemote: any = null
    try { electronRemote = require('@electron/remote') } catch {}

    let selected: string | null = null
    if (electronRemote?.dialog) {
      try {
        const result = electronRemote.dialog.showOpenDialogSync({
          title: '选择工程目录',
          defaultPath: this.lastProjectCwd,
          properties: ['openDirectory'],
        })
        if (result?.length > 0) selected = result[0]
      } catch {}
    }
    if (!selected && typeof window !== 'undefined' && window.prompt) {
      const input = window.prompt('输入工程目录路径', this.lastProjectCwd)
      if (input === null) return null
      selected = String(input).trim().replace(/^"(.*)"$/, '$1')
    }
    if (!selected) return null
    const resolved = path.resolve(selected)
    try {
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        this.notifications.error('目录不存在: ' + resolved)
        return null
      }
    } catch (e: any) { this.notifications.error('目录校验失败: ' + e.message); return null }
    this.lastProjectCwd = resolved
    this.sidebarPanel.updateRoot(resolved)
    return resolved
  }

  async launchKind(kind: string): Promise<void> {
    const cwd = this.chooseProjectDirectory()
    if (!cwd) return
    if (kind === 'codex') await this.launch(makeCodexProfile(cwd))
    else await this.launch(makeClaudeProfile(cwd))
    saveHistoryAsync(kind, cwd)
  }

  async launchInDir(kind: string, cwd: string): Promise<void> {
    if (!cwd) return
    this.lastProjectCwd = cwd
    if (kind === 'codex') await this.launch(makeCodexProfile(cwd))
    else if (kind === 'claude') await this.launch(makeClaudeProfile(cwd))
    else await this.launch(makeShellProfile(cwd))
    if (kind === 'codex' || kind === 'claude') saveHistoryAsync(kind, cwd)
  }

  async launchTeam(): Promise<void> {
    let electronRemote: any = null
    try { electronRemote = require('@electron/remote') } catch {}

    if (!electronRemote?.dialog) {
      this.notifications.info('Teams: 请选择多个目录')
      return
    }

    const result = electronRemote.dialog.showOpenDialogSync({
      title: '选择 Team 目录（可多选）',
      defaultPath: this.lastProjectCwd,
      properties: ['openDirectory', 'multiSelections'],
    })
    if (!result || result.length === 0) return

    await this.teamsService.launchTeam({
      name: 'Team-' + Date.now().toString(36),
      dirs: result,
      agentType: 'claude',
    })
    this.notifications.info(`Agent Team 启动: ${result.length} 个会话`)
  }

  writeToTerminal(text: string): void {
    try {
      const tab = (this.appService as any).activeTab
      if (tab?.session?.write) {
        tab.session.write(text)
      } else {
        let electronRemote: any = null
        try { electronRemote = require('@electron/remote') } catch {}
        if (electronRemote?.clipboard) {
          electronRemote.clipboard.writeText(text)
          this.notifications.info('已复制到剪贴板')
        }
      }
    } catch (e: any) { logError('writeToTerminal', e) }
  }

  getLastProjectCwd(): string { return this.lastProjectCwd }
  getLoadHistory(): any[] { return loadHistory() }
  getSidebarPanel(): any { return this.sidebarPanel }
  getSessionPersist(): SessionPersistService { return this.sessionPersist }

  async restoreSessions(): Promise<void> {
    const sessions = this.sessionPersist.getAll()
    if (sessions.length === 0) {
      this.notifications.info('无可恢复的会话')
      return
    }
    let restored = 0
    for (const s of sessions) {
      const scrollback = this.scrollbackCache.recover(s.kind, s.cwd)
      const tab = await this.launchInDirAndReturn(s.kind, s.cwd)
      if (tab && scrollback) {
        this.injectScrollbackHistory(tab, scrollback, s.kind, s.cwd)
      }
      restored++
    }
    this.sessionPersist.clear()
    this.notifications.info(`已恢复 ${restored} 个 Agent 会话（含历史输出）`)
  }

  private async launchInDirAndReturn(kind: string, cwd: string): Promise<any> {
    if (!cwd) return null
    this.lastProjectCwd = cwd
    if (kind === 'codex') return this.launch(makeCodexProfile(cwd))
    else if (kind === 'claude') return this.launch(makeClaudeProfile(cwd))
    else return this.launch(makeShellProfile(cwd))
  }

  private injectScrollbackHistory(tab: any, scrollback: string, kind: string, cwd: string): void {
    const waitForSession = () => {
      if (tab.destroyed) return
      const session = tab.session
      if (!session?.emitOutput) {
        setTimeout(waitForSession, 300)
        return
      }

      const header = [
        '\x1b[90m',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `  ↺ 已恢复崩溃前的输出历史 (${kind} @ ${path.basename(cwd)})`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '\x1b[0m',
        '',
      ].join('\r\n')

      const lines = scrollback.split('\n')
      const tail = lines.slice(-200).join('\r\n')

      setTimeout(() => {
        try {
          const content = header + tail + '\r\n\x1b[90m━━━ 历史结束 ━━━\x1b[0m\r\n\r\n'
          session.emitOutput(Buffer.from(content))
        } catch {}
      }, 500)
    }

    setTimeout(waitForSession, 200)
  }

  private attachScrollbackCapture(tab: any, kind: string, cwd: string): void {
    const waitForSession = () => {
      if (tab.destroyed) return
      if (tab.session?.output$?.subscribe) {
        const sub = tab.session.output$.subscribe((data: any) => {
          const text = typeof data === 'string' ? data : data?.toString?.() || ''
          if (text) this.scrollbackCache.append(kind, cwd, text)
        })
        this.subscriptions.push(sub)
      } else {
        setTimeout(waitForSession, 500)
      }
    }
    setTimeout(waitForSession, 300)
  }

  private autoRestoreIfNeeded(): void {
    const SHUTDOWN_KEY = 'tabby-agent-mux-clean-shutdown'
    const wasCleanShutdown = localStorage.getItem(SHUTDOWN_KEY) === 'true'
    localStorage.removeItem(SHUTDOWN_KEY)

    window.addEventListener('beforeunload', () => {
      localStorage.setItem(SHUTDOWN_KEY, 'true')
    })

    if (wasCleanShutdown) {
      this.sessionPersist.clear()
      return
    }

    const sessions = this.sessionPersist.getAll()
    if (sessions.length === 0) return

    log(`autoRestore: crash recovery - found ${sessions.length} sessions`)
    setTimeout(() => {
      this.notifications.info(`检测到 ${sessions.length} 个未正常关闭的 Agent 会话，正在恢复...`)
      this.restoreSessions()
    }, 2000)
  }
}
