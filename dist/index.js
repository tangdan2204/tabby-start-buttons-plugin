'use strict'

const fs = require('fs')
const path = require('path')
const core = require('@angular/core')
const tabbyCore = require('tabby-core')
let electronRemote = null
try {
    electronRemote = require('@electron/remote')
} catch {
    // fallback to prompt input
}

const TabbyCorePlugin = tabbyCore.default || tabbyCore
const { CommandProvider, CommandLocation, ProfilesService, NotificationsService } = tabbyCore

const __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    let c = arguments.length
    let r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc
    let d

    for (let i = decorators.length - 1; i >= 0; i--) {
        d = decorators[i]
        if (d) {
            r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r
        }
    }

    if (c > 3 && r) {
        Object.defineProperty(target, key, r)
    }
    return r
}

const __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === 'object' && typeof Reflect.metadata === 'function') {
        return Reflect.metadata(k, v)
    }
}

const DEFAULT_PROJECT_CWD = 'G:\\codex'
const NODE_HOME = 'C:\\Users\\tangdan01\\AppData\\Local\\Programs\\PhpWebStudy-Data\\env\\node'
const WELCOME_PANEL_ID = 'tabby-start-buttons-welcome-panel'


function resolveCommand (preferred, fallback) {
    try {
        if (preferred && fs.existsSync(preferred)) {
            return preferred
        }
    } catch {
        // ignore and fallback
    }
    return fallback
}

const CODEX_CMD = resolveCommand(path.join(NODE_HOME, 'codex.cmd'), 'codex.cmd')
const NPX_CMD = resolveCommand(path.join(NODE_HOME, 'npx.cmd'), 'npx.cmd')

function makeLocalProfile (idSuffix, name, command, args, cwd) {
    return {
        id: `local:custom:tabby-start-buttons:${idSuffix}`,
        type: 'local',
        name,
        icon: 'fas fa-terminal',
        disableDynamicTitle: true,
        options: {
            restoreFromPTYID: null,
            command,
            args,
            cwd,
            env: {
                LANG: 'zh_CN.UTF-8',
                LC_ALL: 'zh_CN.UTF-8',
            },
            width: null,
            height: null,
            pauseAfterExit: false,
            runAsAdministrator: false,
        },
    }
}

function makeCodexProfile (cwd) {
    const folderName = path.basename(cwd)
    return makeLocalProfile('codex', folderName, CODEX_CMD, [], cwd)
}

function makeClaudeProfile (cwd) {
    const folderName = path.basename(cwd)
    return makeLocalProfile('claude', folderName, NPX_CMD, ['-y', '@anthropic-ai/claude-code'], cwd)
}

let StartButtonsCommandProvider = class StartButtonsCommandProvider extends CommandProvider {
    constructor (profilesService, notifications) {
        super()
        this.profilesService = profilesService
        this.notifications = notifications
        this.lastProjectCwd = DEFAULT_PROJECT_CWD
        this.initWelcomeButtons()
    }

    resolveLatestLaunchedTab () {
        const app = this.profilesService && this.profilesService.app
        if (!app) {
            return null
        }
        if (app.activeTab) {
            return app.activeTab
        }
        if (Array.isArray(app.tabs) && app.tabs.length > 0) {
            return app.tabs[app.tabs.length - 1]
        }
        return null
    }

    async launch (profile) {
        try {
            await this.profilesService.launchProfile(profile)
            const tab = this.resolveLatestLaunchedTab()
            if (tab) {
                const profileCwd = profile && profile.options ? profile.options.cwd : ''
                const fallbackTitle = path.basename(profileCwd || this.lastProjectCwd || DEFAULT_PROJECT_CWD)
                const title = String((profile && profile.name) || fallbackTitle || 'Terminal').trim()
                const forceTitle = () => {
                    if (!tab || tab.destroyed) return
                    if (typeof tab.setTitle === 'function') tab.setTitle(title)
                    tab.customTitle = title
                    tab.disableDynamicTitle = true
                    if (tab.inputs && typeof tab.inputs === 'object') {
                        tab.inputs.customTitle = title
                        tab.inputs.disableDynamicTitle = true
                    }
                    if ('enableDynamicTitle' in tab) tab.enableDynamicTitle = false
                    if ('title' in tab && tab.title !== title) tab.title = title
                }
                forceTitle()

                // 前 2 秒内每 100ms 强制覆盖，确保标题立即可见
                let fastElapsed = 0
                const fastInterval = setInterval(() => {
                    fastElapsed += 100
                    if (!tab || tab.destroyed || fastElapsed > 2000) {
                        clearInterval(fastInterval)
                        return
                    }
                    forceTitle()
                }, 100)

                // 订阅标题变更事件，持续覆盖 PTY 发来的标题
                if (tab.titleChange$ && typeof tab.titleChange$.subscribe === 'function') {
                    tab.titleChange$.subscribe(() => {
                        if (!tab.destroyed) forceTitle()
                    })
                } else if (tab.titleChange && typeof tab.titleChange.subscribe === 'function') {
                    tab.titleChange.subscribe(() => {
                        if (!tab.destroyed) forceTitle()
                    })
                }

                // 兜底：2-30 秒内每 2 秒强制一次，覆盖各种异步标题修改
                let elapsed = 0
                const interval = setInterval(() => {
                    elapsed += 2000
                    if (!tab || tab.destroyed || elapsed > 30000) {
                        clearInterval(interval)
                        return
                    }
                    forceTitle()
                }, 2000)
            }
        } catch (error) {
            const message = (error && error.message) ? error.message : String(error)
            this.notifications.error(`Launch failed: ${message}`)
        }
    }

    chooseProjectDirectory () {
        let selected = null

        if (electronRemote && electronRemote.dialog && typeof electronRemote.dialog.showOpenDialogSync === 'function') {
            try {
                const result = electronRemote.dialog.showOpenDialogSync({
                    title: '选择当前开发工程目录',
                    defaultPath: this.lastProjectCwd || DEFAULT_PROJECT_CWD,
                    properties: ['openDirectory', 'createDirectory', 'showHiddenFiles'],
                })
                if (result && result.length > 0) {
                    selected = result[0]
                }
            } catch {
                // ignore and fallback
            }
        }

        if (!selected && typeof window !== 'undefined' && typeof window.prompt === 'function') {
            const input = window.prompt('请输入当前开发工程目录路径', this.lastProjectCwd || DEFAULT_PROJECT_CWD)
            if (input === null) {
                return null
            }
            selected = String(input).trim().replace(/^"(.*)"$/, '$1')
        }

        if (!selected) {
            return null
        }

        const resolved = path.resolve(selected)
        try {
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
                this.notifications.error(`目录不存在: ${resolved}`)
                return null
            }
        } catch (error) {
            const message = (error && error.message) ? error.message : String(error)
            this.notifications.error(`目录校验失败: ${message}`)
            return null
        }

        this.lastProjectCwd = resolved
        return resolved
    }

    async launchKind (kind) {
        const cwd = this.chooseProjectDirectory()
        if (!cwd) {
            return
        }

        if (kind === 'codex') {
            await this.launch(makeCodexProfile(cwd))
            return
        }
        await this.launch(makeClaudeProfile(cwd))
    }

    async provide () {
        return [
            {
                id: 'tabby-start-buttons:codex',
                label: '启动 Codex CLI',
                icon: '<span style=\"font-weight:700;color:#38bdf8\">CX</span>',
                sublabel: '弹框选择工程目录后启动 Codex CLI',
                locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
                run: async () => this.launchKind('codex'),
            },
            {
                id: 'tabby-start-buttons:claude',
                label: '启动 Claude Code',
                icon: '<span style=\"font-weight:700;color:#f59e0b\">CC</span>',
                sublabel: '弹框选择工程目录后启动 Claude Code',
                locations: [CommandLocation.StartPage, CommandLocation.LeftToolbar],
                run: async () => this.launchKind('claude'),
            },
        ]
    }

    injectActiveTabStyles () {
        if (typeof document === 'undefined') {
            return
        }
        if (document.getElementById('tabby-start-buttons-active-tab-style')) {
            return
        }
        const style = document.createElement('style')
        style.id = 'tabby-start-buttons-active-tab-style'
        style.textContent = `
            /* 激活标签页高对比度高亮 — 多层选择器确保覆盖 */
            tab-header.active,
            .tab-bar .tabs tab-header.active,
            .tab-bar > .tabs > tab-header.active,
            app-root .tab-bar .tabs tab-header.active {
                background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
                color: #ffffff !important;
                box-shadow: 0 0 14px rgba(99, 102, 241, 0.7), inset 0 0 0 1px rgba(255,255,255,0.25) !important;
                border-radius: 4px 4px 0 0 !important;
            }
            tab-header.active .index,
            .tab-bar .tabs tab-header.active .index {
                color: #ffffff !important;
                opacity: 1 !important;
            }
            tab-header.active .name,
            .tab-bar .tabs tab-header.active .name {
                color: #ffffff !important;
                font-weight: 700 !important;
                text-shadow: 0 0 6px rgba(255,255,255,0.3) !important;
            }
            tab-header.active button,
            .tab-bar .tabs tab-header.active button {
                color: #ffffff !important;
            }
            tab-header.active .current-tab-indicator,
            .tab-bar .tabs tab-header.active .current-tab-indicator {
                background: #22d3ee !important;
                height: 3px !important;
                box-shadow: 0 0 8px #22d3ee !important;
            }
            /* 非激活标签压暗 */
            tab-header:not(.active),
            .tab-bar .tabs tab-header:not(.active) {
                opacity: 0.55 !important;
                transition: opacity 0.2s ease, background 0.2s ease !important;
            }
            tab-header:not(.active):hover,
            .tab-bar .tabs tab-header:not(.active):hover {
                opacity: 0.85 !important;
                background: rgba(99, 102, 241, 0.12) !important;
            }
        `
        document.head.appendChild(style)
    }

    initWelcomeButtons () {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return
        }
        if (window.__tabbyStartButtonsWelcomeInit) {
            return
        }
        window.__tabbyStartButtonsWelcomeInit = true
        this.injectActiveTabStyles()

        const renderWelcomeButtons = () => {
            const container = document.querySelector('welcome-page .container.mt-3.mb-3')
            if (!container) {
                return
            }
            if (document.getElementById(WELCOME_PANEL_ID)) {
                return
            }

            const anchor = container.querySelector('.text-center.mt-5') || container.lastElementChild || container
            const panel = document.createElement('div')
            panel.id = WELCOME_PANEL_ID
            panel.className = 'text-center mt-4'
            panel.innerHTML = `
                <div style="margin-bottom: 10px; opacity: 0.9;">AI CLI 一键启动（弹框选择工程目录）</div>
                <button class="btn me-2" style="background:#0284c7;color:#ffffff;border:none;" id="tabby-start-buttons-welcome-codex">启动 Codex CLI</button>
                <button class="btn" style="background:#d97706;color:#ffffff;border:none;" id="tabby-start-buttons-welcome-claude">启动 Claude Code</button>
            `

            if (anchor.parentNode) {
                anchor.parentNode.insertBefore(panel, anchor)
            } else {
                container.appendChild(panel)
            }

            const codexButton = document.getElementById('tabby-start-buttons-welcome-codex')
            const claudeButton = document.getElementById('tabby-start-buttons-welcome-claude')
            if (codexButton) {
                codexButton.addEventListener('click', () => this.launchKind('codex'))
            }
            if (claudeButton) {
                claudeButton.addEventListener('click', () => this.launchKind('claude'))
            }
        }

        renderWelcomeButtons()
        window.setInterval(renderWelcomeButtons, 1000)
    }
}

StartButtonsCommandProvider.ctorParameters = () => [
    { type: ProfilesService },
    { type: NotificationsService },
]

StartButtonsCommandProvider = __decorate([
    core.Injectable(),
    __metadata('design:paramtypes', [ProfilesService, NotificationsService]),
], StartButtonsCommandProvider)

let TabbyStartButtonsModule = class TabbyStartButtonsModule {}

TabbyStartButtonsModule = __decorate([
    core.NgModule({
        imports: [
            TabbyCorePlugin,
        ],
        providers: [
            { provide: CommandProvider, useClass: StartButtonsCommandProvider, multi: true },
        ],
    }),
], TabbyStartButtonsModule)

// 模块加载时立即注入活动标签高亮样式（不依赖 Angular DI）
;(function injectTabStylesOnLoad () {
    if (typeof document === 'undefined') return
    if (document.getElementById('tabby-start-buttons-active-tab-style')) return

    function doInject () {
        if (document.getElementById('tabby-start-buttons-active-tab-style')) return
        const style = document.createElement('style')
        style.id = 'tabby-start-buttons-active-tab-style'
        style.textContent = `
            /* === 激活标签高对比度高亮 === */
            tab-header.active,
            .tabs tab-header.active,
            .tab-bar .tabs tab-header.active {
                background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
                color: #ffffff !important;
                box-shadow: 0 0 14px rgba(99, 102, 241, 0.7), inset 0 0 0 1px rgba(255,255,255,0.25) !important;
                border-radius: 4px 4px 0 0 !important;
            }
            tab-header.active .index,
            .tabs tab-header.active .index {
                color: #ffffff !important;
                opacity: 1 !important;
            }
            tab-header.active .name,
            .tabs tab-header.active .name {
                color: #ffffff !important;
                font-weight: 700 !important;
                text-shadow: 0 0 6px rgba(255,255,255,0.3) !important;
            }
            tab-header.active button,
            .tabs tab-header.active button {
                color: #ffffff !important;
            }
            tab-header.active .current-tab-indicator,
            .tabs tab-header.active .current-tab-indicator {
                background: #22d3ee !important;
                height: 3px !important;
                box-shadow: 0 0 8px #22d3ee !important;
            }
            /* 非激活标签压暗 */
            tab-header:not(.active),
            .tabs tab-header:not(.active) {
                opacity: 0.55 !important;
                transition: opacity 0.2s ease, background 0.2s ease !important;
            }
            tab-header:not(.active):hover,
            .tabs tab-header:not(.active):hover {
                opacity: 0.85 !important;
                background: rgba(99, 102, 241, 0.12) !important;
            }
        `
        ;(document.head || document.documentElement).appendChild(style)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doInject)
    } else {
        doInject()
    }
    // 延迟兜底，确保 Angular 渲染后样式仍在
    setTimeout(doInject, 500)
    setTimeout(doInject, 2000)
})()

module.exports = TabbyStartButtonsModule
module.exports.default = TabbyStartButtonsModule
module.exports.StartButtonsCommandProvider = StartButtonsCommandProvider
