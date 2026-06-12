import { Injectable } from '@angular/core'
import { Subscription } from 'rxjs'
import { AppService } from 'tabby-core'
import { AgentMonitorService } from './agent-monitor.service'
import { TabMetadataService } from './tab-metadata.service'
import { log } from '../utils/logger'

@Injectable({ providedIn: 'root' })
export class TabMonitorService {
  private alive = new Subscription()
  private monitoredTabs = new WeakSet<any>()
  private tabSubs = new WeakMap<any, Subscription>()
  private pendingIntervals = new Set<any>()
  private started = false
  private destroyed = false

  constructor(
    private appService: AppService,
    private agentMonitor: AgentMonitorService,
    private tabMetadata: TabMetadataService,
  ) {}

  start(): void {
    if (this.started || this.destroyed) return
    this.started = true

    const attachMonitor = (tab: any) => {
      if (!tab || this.destroyed || this.monitoredTabs.has(tab)) return
      this.monitoredTabs.add(tab)
      const perTab = new Subscription()
      this.tabSubs.set(tab, perTab)

      const tryAttachOutput = () => {
        if (tab.destroyed || this.destroyed) return
        if (tab.session?.output$?.subscribe) {
          perTab.add(tab.session.output$.subscribe((data: any) => {
            const text = typeof data === 'string' ? data : data?.toString?.() || ''
            if (text) this.agentMonitor.updateOutput(tab, text)
          }))
          this.tabMetadata.track(tab)
        }
      }

      tryAttachOutput()
      if (!tab.session?.output$) {
        let retries = 0
        const iv = setInterval(() => {
          retries++
          if (tab.destroyed || this.destroyed || retries > 10) {
            clearInterval(iv)
            this.pendingIntervals.delete(iv)
            return
          }
          if (tab.session?.output$) {
            clearInterval(iv)
            this.pendingIntervals.delete(iv)
            tryAttachOutput()
          }
        }, 500)
        this.pendingIntervals.add(iv)
      }

      if (tab.sessionChanged$?.subscribe) {
        perTab.add(tab.sessionChanged$.subscribe(() => {
          tryAttachOutput()
        }))
      }

      if (tab.destroyed$?.subscribe) {
        perTab.add(tab.destroyed$.subscribe(() => {
          this.agentMonitor.removeTab(tab)
          const sub = this.tabSubs.get(tab)
          if (sub) { sub.unsubscribe(); this.tabSubs.delete(tab) }
        }))
      }
    }

    const existingTabs = (this.appService as any).tabs || []
    for (const tab of existingTabs) attachMonitor(tab)

    if ((this.appService as any).tabOpened$?.subscribe) {
      this.alive.add((this.appService as any).tabOpened$.subscribe((tab: any) => {
        attachMonitor(tab)
      }))
    }

    if ((this.appService as any).tabsChanged$?.subscribe) {
      this.alive.add((this.appService as any).tabsChanged$.subscribe(() => {
        const tabs = (this.appService as any).tabs || []
        for (const tab of tabs) attachMonitor(tab)
      }))
    }

    log('TabMonitorService: auto-monitoring enabled')
  }

  destroy(): void {
    this.destroyed = true
    this.alive.unsubscribe()
    for (const iv of this.pendingIntervals) clearInterval(iv)
    this.pendingIntervals.clear()
  }
}
