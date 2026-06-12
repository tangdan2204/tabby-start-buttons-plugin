import { Injectable } from '@angular/core'
import { Subscription } from 'rxjs'
import { CommandProvider, CommandLocation, NotificationsService, AppService } from 'tabby-core'
import { log, logError } from '../utils/logger'
import { LaunchService } from '../services/launch.service'
import { TeamsService } from '../services/teams.service'
import { EventBusService } from '../services/event-bus.service'
import { TabMonitorService } from '../services/tab-monitor.service'
import { PasteGuardService } from '../services/paste-guard.service'
import { RecoveryService } from '../services/recovery.service'
import { AgentMonitorService } from '../services/agent-monitor.service'
import { TabMetadataService } from '../services/tab-metadata.service'
import { SessionPersistService } from '../services/session-persist.service'
import { NotificationGlow } from '../ui/notification-glow'
import { SidebarPanel } from '../ui/sidebar-panel'
import { WelcomeButtons } from '../ui/welcome-buttons'
import { TabProtection } from '../ui/tab-protection'
import { BrowserPanel } from '../ui/browser-panel'

@Injectable()
export class AgentMuxCommandProvider extends CommandProvider {
  private initialized = false
  private destroyed = false
  private alive = new Subscription()

  private notificationGlow: NotificationGlow
  private sidebarPanel: SidebarPanel
  private welcomeButtons: WelcomeButtons
  private tabProtection: TabProtection
  private browserPanel: BrowserPanel

  constructor(
    private appService: AppService,
    private notifications: NotificationsService,
    private launchService: LaunchService,
    private teamsService: TeamsService,
    private eventBus: EventBusService,
    private tabMonitor: TabMonitorService,
    private pasteGuard: PasteGuardService,
    private recoveryService: RecoveryService,
    private agentMonitor: AgentMonitorService,
    private tabMetadata: TabMetadataService,
    private sessionPersist: SessionPersistService,
  ) {
    super()

    this.notificationGlow = new NotificationGlow(appService, this.agentMonitor)
    this.sidebarPanel = new SidebarPanel(
      appService, this.agentMonitor, this.tabMetadata,
      this.launchService, this.sessionPersist, this.eventBus,
    )
    this.welcomeButtons = new WelcomeButtons(this.eventBus, this.sessionPersist)
    this.tabProtection = new TabProtection(appService, notifications)
    this.browserPanel = new BrowserPanel(this.eventBus)

    this.launchService.setTabProtection(this.tabProtection)

    log('AgentMuxCommandProvider constructed')
    this.deferredInit()
  }

  private deferredInit(): void {
    setTimeout(() => {
      if (this.destroyed || this.initialized) return
      this.initialized = true
      this.initAll()
      this.bindHotkeys()
      this.subscribeEventBus()
      log('deferredInit complete')
    }, 0)
  }

  private initAll(): void {
    const safeInit = (name: string, fn: () => void) => {
      try { fn() } catch (e: any) { logError(`${name}.init`, e) }
    }
    safeInit('NotificationGlow', () => this.notificationGlow.init())
    safeInit('SidebarPanel', () => this.sidebarPanel.init())
    safeInit('WelcomeButtons', () => this.welcomeButtons.init())
    safeInit('TabProtection', () => this.tabProtection.init())
    safeInit('BrowserPanel', () => this.browserPanel.init())
    safeInit('TabMonitor', () => this.tabMonitor.start())
    safeInit('PasteGuard', () => this.pasteGuard.start())
    safeInit('Recovery', () => this.recoveryService.start())
  }

  private subscribeEventBus(): void {
    this.alive.add(this.eventBus.launchRequest$.subscribe(ev => {
      if (ev.kind === 'shell') {
        this.recoveryService.restoreSessions()
      } else if (ev.cwd) {
        this.launchService.launchInDir(ev.kind, ev.cwd)
      } else {
        this.launchService.launchKind(ev.kind)
      }
    }))

    this.alive.add(this.eventBus.sidebarToggleRequest$.subscribe(() => {
      this.sidebarPanel.toggle()
    }))

    this.alive.add(this.eventBus.browserToggleRequest$.subscribe(() => {
      this.browserPanel.toggle()
    }))

    this.alive.add(this.eventBus.teamLaunchRequest$.subscribe(() => {
      this.launchTeam()
    }))

    this.alive.add(this.eventBus.portClick$.subscribe(ev => {
      this.browserPanel.open(`http://localhost:${ev.port}`)
    }))

    this.alive.add(this.eventBus.layoutChange$.subscribe(ev => {
      if (ev.sidebar === true && this.browserPanel.isVisible()) {
        this.browserPanel.close()
      }
      if (ev.browser === true && this.sidebarPanel.isVisible()) {
        this.sidebarPanel.toggle()
      }
    }))

    this.alive.add(this.eventBus.directoryChange$.subscribe(ev => {
      this.sidebarPanel.updateRoot(ev.cwd)
    }))
  }

  private bindHotkeys(): void {
    try {
      const hotkeys = (this.appService as any).hotkeys
      if (!hotkeys?.hotkey$?.subscribe) return
      this.alive.add(hotkeys.hotkey$.subscribe((id: string) => {
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
      }))
    } catch {}
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    this.alive.unsubscribe()
    this.launchService.markDestroyed()

    try { this.notificationGlow.destroy() } catch {}
    try { this.sidebarPanel.destroy() } catch {}
    try { this.welcomeButtons.destroy() } catch {}
    try { this.tabProtection.destroy() } catch {}
    try { this.browserPanel.destroy() } catch {}
    try { this.tabMonitor.destroy() } catch {}
    try { this.pasteGuard.destroy() } catch {}
    try { this.recoveryService.destroy() } catch {}
    try { this.eventBus.destroy() } catch {}

    log('AgentMuxCommandProvider destroyed')
  }

  async provide(): Promise<any[]> {
    return [
      {
        id: 'tabby-agent-mux:codex',
        label: '启动 Codex CLI',
        icon: '<span style="font-weight:700;color:#38bdf8">CX</span>',
        sublabel: '选择工程目录后启动 Codex',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.launchService.launchKind('codex'),
      },
      {
        id: 'tabby-agent-mux:claude',
        label: '启动 Claude Code',
        icon: '<span style="font-weight:700;color:#f59e0b">CC</span>',
        sublabel: '选择工程目录后启动 Claude Code',
        locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
        run: async () => this.launchService.launchKind('claude'),
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
        run: async () => this.recoveryService.restoreSessions(),
      },
    ]
  }

  private async launchTeam(): Promise<void> {
    let electronRemote: any = null
    try { electronRemote = require('@electron/remote') } catch {}

    if (!electronRemote?.dialog) {
      this.notifications.info('Teams: 请选择多个目录')
      return
    }

    const result = electronRemote.dialog.showOpenDialogSync({
      title: '选择 Team 目录（可多选）',
      defaultPath: this.launchService.getLastProjectCwd(),
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
}
