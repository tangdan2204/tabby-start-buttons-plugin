import { NgModule } from '@angular/core'
import { TabbyCoreModule, CommandProvider } from 'tabby-core'
import { AgentMuxCommandProvider } from './providers/command.provider'
import { AgentHotkeyProvider } from './providers/hotkey.provider'
import { AgentMuxToolbarProvider } from './providers/toolbar.provider'
import { ScrollbackCacheService } from './services/scrollback-cache.service'
import { log } from './utils/logger'

declare const require: any
const { HotkeyProvider, ToolbarButtonProvider } = require('tabby-core')

@NgModule({
  imports: [TabbyCoreModule],
  providers: [
    AgentMuxCommandProvider,
    AgentMuxToolbarProvider,
    ScrollbackCacheService,
    { provide: CommandProvider, useClass: AgentMuxCommandProvider, multi: true },
    { provide: HotkeyProvider, useClass: AgentHotkeyProvider, multi: true },
    { provide: ToolbarButtonProvider, useClass: AgentMuxToolbarProvider, multi: true },
  ],
})
export default class TabbyAgentMuxModule {
  constructor(
    private commandProvider: AgentMuxCommandProvider,
    private toolbarProvider: AgentMuxToolbarProvider,
  ) {
    this.toolbarProvider.setCommandProvider(this.commandProvider)
    log('TabbyAgentMuxModule instantiated - v0.8.1')
  }
}
