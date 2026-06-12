import { Injectable } from '@angular/core'
import { log } from '../utils/logger'
import { LaunchService } from '../services/launch.service'
import { EventBusService } from '../services/event-bus.service'

declare const require: any
const tabbyCore = require('tabby-core')
const { ToolbarButtonProvider } = tabbyCore

@Injectable()
export class AgentMuxToolbarProvider extends ToolbarButtonProvider {
  weight = 5

  constructor(
    private launchService: LaunchService,
    private eventBus: EventBusService,
  ) {
    super()
    log('AgentMuxToolbarProvider constructed')
  }

  async provide(): Promise<any[]> {
    return [
      {
        icon: 'fas fa-rocket',
        title: '启动 Codex CLI',
        weight: 10,
        click: () => this.launchService.launchKind('codex'),
      },
      {
        icon: 'fas fa-bolt',
        title: '启动 Claude Code',
        weight: 11,
        click: () => this.launchService.launchKind('claude'),
      },
      {
        icon: 'fas fa-columns',
        title: '切换 Agent 面板',
        weight: 12,
        click: () => this.eventBus.emitSidebarToggle(),
      },
      {
        icon: 'fas fa-users',
        title: '启动 Agent Team',
        weight: 13,
        click: () => this.eventBus.emitTeamLaunchRequest(),
      },
    ]
  }
}
