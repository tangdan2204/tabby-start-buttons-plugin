import { Injectable } from '@angular/core'
import { Subject, Observable } from 'rxjs'

export interface LayoutChangeEvent {
  sidebar?: boolean
  browser?: boolean
}

export interface LaunchRequestEvent {
  kind: 'codex' | 'claude' | 'shell'
  cwd?: string
}

export interface PortClickEvent {
  port: number
}

export interface DirectoryChangeEvent {
  cwd: string
}

@Injectable({ providedIn: 'root' })
export class EventBusService {
  private layoutChange = new Subject<LayoutChangeEvent>()
  private launchRequest = new Subject<LaunchRequestEvent>()
  private portClick = new Subject<PortClickEvent>()
  private directoryChange = new Subject<DirectoryChangeEvent>()
  private teamLaunchRequest = new Subject<void>()
  private sidebarToggleRequest = new Subject<void>()
  private browserToggleRequest = new Subject<void>()

  readonly layoutChange$: Observable<LayoutChangeEvent> = this.layoutChange.asObservable()
  readonly launchRequest$: Observable<LaunchRequestEvent> = this.launchRequest.asObservable()
  readonly portClick$: Observable<PortClickEvent> = this.portClick.asObservable()
  readonly directoryChange$: Observable<DirectoryChangeEvent> = this.directoryChange.asObservable()
  readonly teamLaunchRequest$: Observable<void> = this.teamLaunchRequest.asObservable()
  readonly sidebarToggleRequest$: Observable<void> = this.sidebarToggleRequest.asObservable()
  readonly browserToggleRequest$: Observable<void> = this.browserToggleRequest.asObservable()

  emitLayoutChange(event: LayoutChangeEvent): void {
    this.layoutChange.next(event)
  }

  emitLaunchRequest(event: LaunchRequestEvent): void {
    this.launchRequest.next(event)
  }

  emitPortClick(event: PortClickEvent): void {
    this.portClick.next(event)
  }

  emitDirectoryChange(event: DirectoryChangeEvent): void {
    this.directoryChange.next(event)
  }

  emitTeamLaunchRequest(): void {
    this.teamLaunchRequest.next()
  }

  emitSidebarToggle(): void {
    this.sidebarToggleRequest.next()
  }

  emitBrowserToggle(): void {
    this.browserToggleRequest.next()
  }

  destroy(): void {
    this.layoutChange.complete()
    this.launchRequest.complete()
    this.portClick.complete()
    this.directoryChange.complete()
    this.teamLaunchRequest.complete()
    this.sidebarToggleRequest.complete()
    this.browserToggleRequest.complete()
  }
}
