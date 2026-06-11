import { Injectable } from '@angular/core'
import { log } from '../utils/logger'

declare const require: any
const tabbyCore = require('tabby-core')
const { ToolbarButtonProvider } = tabbyCore

@Injectable()
export class AgentMuxToolbarProvider extends ToolbarButtonProvider {
  private commandProviderRef: any = null

  weight = 5

  setCommandProvider(cp: any): void {
    this.commandProviderRef = cp
  }

  async provide(): Promise<any[]> {
    return [
      {
        icon: 'fas fa-rocket',
        title: '启动 Codex CLI',
        weight: 10,
        click: () => {
          this.commandProviderRef?.launchKind?.('codex')
        },
      },
      {
        icon: 'fas fa-bolt',
        title: '启动 Claude Code',
        weight: 11,
        click: () => {
          this.commandProviderRef?.launchKind?.('claude')
        },
      },
      {
        icon: 'fas fa-columns',
        title: '切换 Agent 面板',
        weight: 12,
        click: () => {
          this.commandProviderRef?.getSidebarPanel?.()?.toggle()
        },
      },
      {
        icon: 'fas fa-users',
        title: '启动 Agent Team',
        weight: 13,
        click: () => {
          this.commandProviderRef?.launchTeam?.()
        },
      },
    ]
  }

  constructor() {
    super()
    log('AgentMuxToolbarProvider constructed')
  }
}
