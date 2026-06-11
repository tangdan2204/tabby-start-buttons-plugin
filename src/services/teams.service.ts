import { Injectable } from '@angular/core'
import { ProfilesService, AppService } from 'tabby-core'
import { log, logError } from '../utils/logger'
import { makeClaudeProfile, makeCodexProfile, makeShellProfile } from '../config'
import { PaneHeader } from '../ui/pane-header'

export interface TeamConfig {
  name: string
  dirs: string[]
  agentType: 'claude' | 'codex' | 'shell'
}

@Injectable({ providedIn: 'root' })
export class TeamsService {
  private paneHeader: PaneHeader | null = null

  constructor(
    private profilesService: ProfilesService,
    private appService: AppService,
  ) {
    this.paneHeader = new PaneHeader(appService)
    setTimeout(() => this.paneHeader!.init(), 0)
  }

  async launchTeam(config: TeamConfig): Promise<any> {

    const { dirs, agentType, name } = config
    if (dirs.length === 0) return null

    log(`Launching team "${name}" with ${dirs.length} agents (${agentType})`)

    const tabs: any[] = []
    for (const dir of dirs) {
      const profile = this.makeProfile(agentType, dir)
      try {
        const tab = await this.profilesService.openNewTabForProfile(profile)
        if (tab) {
          // Force title to folder name so pane header can display it
          const folderName = dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || dir
          tab.customTitle = folderName
          tab.disableDynamicTitle = true
          tabs.push(tab)
        }
      } catch (e: any) { logError('team tab launch', e) }
    }

    if (tabs.length < 2) {
      log(`Team "${name}": only ${tabs.length} tabs opened, no splitting needed`)
      return tabs[0] || null
    }

    // Try to split tabs using Tabby's native split API
    try {
      const firstTab = tabs[0]

      // Find the SplitTabComponent wrapping our first tab
      // Tabby wraps each new tab in a SplitTabComponent automatically
      let splitTab = firstTab.parent
      if (!splitTab?.addTab) {
        // Try appService.wrapAndAddTab pattern — but tab already added
        // Tabby's tabs are already wrapped; access via .parent
        splitTab = this.findSplitParent(firstTab)
      }

      if (splitTab?.addTab) {
        for (let i = 1; i < tabs.length; i++) {
          const direction = this.getDirection(i, tabs.length)
          try {
            const childSplit = tabs[i].parent
            if (childSplit && childSplit !== splitTab) {
              tabs[i].removeFromContainer?.()
            }
            await splitTab.addTab(tabs[i], tabs[i - 1], direction)
          } catch (e: any) {
            logError(`team split tab ${i}`, e)
          }
        }
        try { splitTab.equalize?.() } catch {}

        // Inject visible pane headers showing folder names
        if (this.paneHeader) {
          this.paneHeader.injectHeaders(tabs, agentType)
        }

        log(`Team "${name}" split layout applied`)
        return splitTab
      } else {
        log(`Team "${name}": split parent not found, tabs opened as separate`)
      }
    } catch (e: any) {
      logError('team split layout', e)
    }

    return tabs
  }

  private makeProfile(type: string, cwd: string): any {
    switch (type) {
      case 'codex': return makeCodexProfile(cwd)
      case 'shell': return makeShellProfile(cwd)
      default: return makeClaudeProfile(cwd)
    }
  }

  private getDirection(index: number, total: number): string {
    if (total <= 2) return 'r'
    if (total <= 4) {
      // 2x2 grid: right, bottom, right
      if (index === 1) return 'r'
      if (index === 2) return 'b'
      return 'r'
    }
    return (index % 3 === 0) ? 'b' : 'r'
  }

  private findSplitParent(tab: any): any {
    // Walk up tab.parent chain
    let current = tab.parent
    while (current) {
      if (current.addTab) return current
      current = current.parent
    }
    // Fallback: search all app tabs
    if (!this.appService?.tabs) return null
    for (const t of this.appService.tabs) {
      if (t.addTab) return t
    }
    return null
  }
}
