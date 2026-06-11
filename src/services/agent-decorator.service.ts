import { Injectable } from '@angular/core'
import { AgentMonitorService } from './agent-monitor.service'
import { TabMetadataService } from './tab-metadata.service'
import { log, logError } from '../utils/logger'

declare const require: any

let TerminalDecorator: any

try {
  const tabbyTerminal = require('tabby-terminal')
  TerminalDecorator = tabbyTerminal.TerminalDecorator
  log('tabby-terminal loaded: TerminalDecorator=' + typeof TerminalDecorator)
} catch (e: any) {
  logError('tabby-terminal import', e)
}

class AgentOutputMiddleware {
  private currentLine = ''
  private debounceTimer: any = null
  outputToTerminal: any
  outputToSession: any

  constructor(
    private monitor: AgentMonitorService,
    private tab: any,
  ) {}

  feedFromSession(data: Buffer): void {
    const text = data.toString('utf-8')

    this.monitor.updateOutput(this.tab, text)

    if (this.outputToTerminal) {
      this.outputToTerminal.next(data)
    }
  }

  feedFromTerminal(data: Buffer): void {
    if (this.outputToSession) {
      this.outputToSession.next(data)
    }
  }

  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
  }
}

@Injectable()
export class AgentMonitorDecorator {
  constructor(private agentMonitor: AgentMonitorService, private tabMetadata: TabMetadataService) {
    log('AgentMonitorDecorator constructed')
  }

  attach(terminal: any): void {
    try {
      this.doAttach(terminal)
    } catch (e: any) {
      logError('AgentMonitorDecorator.attach', e)
    }
  }

  private doAttach(terminal: any): void {
    log('Decorating terminal tab: ' + (terminal?.customTitle || 'unnamed'))

    this.tabMetadata.track(terminal)

    const attachMiddleware = () => {
      if (!terminal.session) return
      const mw = new AgentOutputMiddleware(this.agentMonitor, terminal)

      if (terminal.session.middleware) {
        terminal.session.middleware.push(mw)
      } else if (terminal.session.output$?.subscribe) {
        terminal.session.output$.subscribe((data: any) => {
          this.agentMonitor.updateOutput(terminal, data.toString('utf-8'))
        })
      }
    }

    attachMiddleware()

    if (terminal.sessionChanged$?.subscribe) {
      terminal.sessionChanged$.subscribe(() => attachMiddleware())
    }

    if (terminal.destroyed$?.subscribe) {
      terminal.destroyed$.subscribe(() => {
        this.agentMonitor.removeTab(terminal)
      })
    }
  }
}

export { TerminalDecorator }
