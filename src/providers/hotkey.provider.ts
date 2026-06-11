import { Injectable } from '@angular/core'
import { log } from '../utils/logger'

declare const require: any
const tabbyCore = require('tabby-core')
const { HotkeyProvider } = tabbyCore

@Injectable()
export class AgentHotkeyProvider extends HotkeyProvider {
  hotkeys = [
    {
      id: 'agent-mux:jump-unread',
      name: '跳转到等待中的 Agent',
    },
    {
      id: 'agent-mux:mark-all-read',
      name: '标记所有通知已读',
    },
    {
      id: 'agent-mux:toggle-sidebar',
      name: '切换 Agent 面板',
    },
  ]

  constructor() {
    super()
    log('AgentHotkeyProvider constructed')
  }

  async provide() {
    return this.hotkeys
  }
}

export const hotkeyConfigDefaults = {
  hotkeys: {
    'agent-mux:jump-unread': ['Ctrl-Shift-U'],
    'agent-mux:mark-all-read': ['Ctrl-Shift-M'],
    'agent-mux:toggle-sidebar': ['Ctrl-Shift-B'],
  },
}
