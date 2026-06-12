import { NgModule, OnDestroy } from '@angular/core'
import { TabbyCoreModule, CommandProvider } from 'tabby-core'
import { AgentMuxCommandProvider } from './providers/command.provider'
import { AgentHotkeyProvider } from './providers/hotkey.provider'
import { AgentMuxToolbarProvider } from './providers/toolbar.provider'
import { ConfigService } from './config'
import { LaunchService } from './services/launch.service'
import { EventBusService } from './services/event-bus.service'
import { TabMonitorService } from './services/tab-monitor.service'
import { PasteGuardService } from './services/paste-guard.service'
import { RecoveryService } from './services/recovery.service'
import { AgentMonitorService } from './services/agent-monitor.service'
import { TabMetadataService } from './services/tab-metadata.service'
import { TeamsService } from './services/teams.service'
import { SessionPersistService } from './services/session-persist.service'
import { ScrollbackCacheService } from './services/scrollback-cache.service'
import { ProcessKeepAliveService } from './services/process-keepalive.service'
import { log } from './utils/logger'

declare const require: any
const { HotkeyProvider, ToolbarButtonProvider } = require('tabby-core')

@NgModule({
  imports: [TabbyCoreModule],
  providers: [
    ConfigService,
    EventBusService,
    AgentMonitorService,
    TabMetadataService,
    SessionPersistService,
    ScrollbackCacheService,
    ProcessKeepAliveService,
    LaunchService,
    TabMonitorService,
    PasteGuardService,
    RecoveryService,
    TeamsService,
    AgentMuxCommandProvider,
    AgentMuxToolbarProvider,
    { provide: CommandProvider, useExisting: AgentMuxCommandProvider, multi: true },
    { provide: HotkeyProvider, useClass: AgentHotkeyProvider, multi: true },
    { provide: ToolbarButtonProvider, useExisting: AgentMuxToolbarProvider, multi: true },
  ],
})
export default class TabbyAgentMuxModule implements OnDestroy {
  constructor(private commandProvider: AgentMuxCommandProvider) {
    log('TabbyAgentMuxModule instantiated - v1.0.0')
  }

  ngOnDestroy(): void {
    try { this.commandProvider.destroy() } catch {}
    log('TabbyAgentMuxModule destroyed')
  }
}
