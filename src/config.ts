import { Injectable } from '@angular/core'
import * as fs from 'fs'
import * as path from 'path'
import { log } from './utils/logger'

export interface PluginConfig {
  defaultProjectDir: string
  nodeHome: string | null
  codexCmd: string | null
  npxCmd: string | null
  notifications: {
    sound: boolean
    osBanner: boolean
    glowEnabled: boolean
  }
  sidebar: {
    mode: 'files' | 'agents'
    width: number
    visible: boolean
  }
  teams: {
    presets: any[]
  }
  browser: {
    defaultWidth: number
    position: 'right' | 'bottom'
  }
}

const DELIMITER = path.delimiter

function whichSync(cmd: string): string | null {
  const pathEnv = process.env.PATH || ''
  const exts = (process.env.PATHEXT || '.CMD;.EXE;.BAT').split(';')
  for (const dir of pathEnv.split(DELIMITER)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext)
      try { if (fs.existsSync(full)) return full } catch {}
    }
  }
  return null
}

function findInCommonPaths(cmd: string): string | null {
  const flyenvPattern = path.join(
    process.env.PROGRAMFILES || 'C:\\Program Files',
    'FlyEnv-Data', 'app', 'nodejs'
  )

  if (fs.existsSync(flyenvPattern)) {
    try {
      const versions = fs.readdirSync(flyenvPattern)
        .filter(d => d.startsWith('v'))
        .sort()
        .reverse()
      for (const ver of versions) {
        const candidate = path.join(flyenvPattern, ver, cmd)
        if (fs.existsSync(candidate)) return candidate
      }
    } catch {}
  }

  const bases = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
  ].filter(Boolean)

  for (const base of bases) {
    if (!base) continue
    const candidate = path.join(base, 'nodejs', cmd)
    try { if (fs.existsSync(candidate)) return candidate } catch {}
  }

  return null
}

function resolveCommand(name: string, winExt: string): string {
  const withExt = name.endsWith(winExt) ? name : name + winExt
  const found = whichSync(withExt) || findInCommonPaths(withExt)
  if (found) {
    log(`Resolved ${name} → ${found}`)
    return found
  }
  return withExt
}

function getDefaultProjectDir(): string {
  const candidates = [
    'G:\\codex',
    'D:\\codex',
    'C:\\codex',
    path.join(process.env.USERPROFILE || '', 'projects'),
    path.join(process.env.USERPROFILE || '', 'code'),
    process.env.USERPROFILE || 'C:\\Users\\Default',
  ]
  for (const dir of candidates) {
    try { if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir } catch {}
  }
  return process.env.USERPROFILE || 'C:\\'
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private config: PluginConfig
  private commandsResolved = false

  constructor() {
    this.config = {
      defaultProjectDir: getDefaultProjectDir(),
      nodeHome: null,
      codexCmd: null,
      npxCmd: null,
      notifications: {
        sound: false,
        osBanner: true,
        glowEnabled: true,
      },
      sidebar: {
        mode: 'agents',
        width: 260,
        visible: true,
      },
      teams: { presets: [] },
      browser: {
        defaultWidth: 40,
        position: 'right',
      },
    }
    setTimeout(() => this.resolveCommands(), 0)
  }

  get(): PluginConfig {
    return this.config
  }

  ensureCommandsResolved(): void {
    this.resolveCommands()
  }

  makeLocalProfile(idSuffix: string, name: string, command: string, args: string[], cwd: string) {
    return {
      id: `local:custom:tabby-agent-mux:${idSuffix}`,
      type: 'local',
      name,
      icon: 'fas fa-terminal',
      disableDynamicTitle: true,
      options: {
        restoreFromPTYID: null,
        command,
        args,
        cwd,
        env: { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' },
        width: null,
        height: null,
        pauseAfterExit: true,
        runAsAdministrator: false,
      },
    }
  }

  makeCodexProfile(cwd: string) {
    this.ensureCommandsResolved()
    return this.makeLocalProfile('codex', path.basename(cwd), this.config.codexCmd || 'codex.cmd', [], cwd)
  }

  makeClaudeProfile(cwd: string) {
    this.ensureCommandsResolved()
    const claudeCmd = resolveCommand('claude', '.cmd')
    return this.makeLocalProfile('claude', path.basename(cwd), claudeCmd, [], cwd)
  }

  makeShellProfile(cwd: string) {
    return this.makeLocalProfile('shell', path.basename(cwd), 'powershell.exe', ['-NoLogo'], cwd)
  }

  private resolveCommands(): void {
    if (this.commandsResolved) return
    this.commandsResolved = true

    const codexCmd = resolveCommand('codex', '.cmd')
    const npxCmd = resolveCommand('npx', '.cmd')
    this.config.codexCmd = codexCmd
    this.config.npxCmd = npxCmd
    this.config.nodeHome = npxCmd ? path.dirname(npxCmd) : null
    log(`Config resolved: codex=${codexCmd}, npx=${npxCmd}, projectDir=${this.config.defaultProjectDir}`)
  }
}

// Backward-compatible exports for existing code during migration
let _legacyInstance: ConfigService | null = null

export function getConfig(): PluginConfig {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  return _legacyInstance.get()
}

export function ensureCommandsResolved(): void {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  _legacyInstance.ensureCommandsResolved()
}

export function makeCodexProfile(cwd: string) {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  return _legacyInstance.makeCodexProfile(cwd)
}

export function makeClaudeProfile(cwd: string) {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  return _legacyInstance.makeClaudeProfile(cwd)
}

export function makeShellProfile(cwd: string) {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  return _legacyInstance.makeShellProfile(cwd)
}

export function makeLocalProfile(idSuffix: string, name: string, command: string, args: string[], cwd: string) {
  if (!_legacyInstance) _legacyInstance = new ConfigService()
  return _legacyInstance.makeLocalProfile(idSuffix, name, command, args, cwd)
}
