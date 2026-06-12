const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8')
}

const checks = [
  {
    name: 'logger uses per-process log file',
    file: 'src/utils/logger.ts',
    mustMatch: [/debug-\$\{process\.pid\.toString\(36\)\}\.log/],
    mustNotMatch: [/debug\.log/],
  },
  {
    name: 'launch history file is instance-scoped',
    file: 'src/services/launch.service.ts',
    mustMatch: [
      /history-\$\{process\.pid\.toString\(36\)\}/,
      /Math\.random\(\)\.toString\(36\)\.slice\(2,\s*8\)/,
      /LEGACY_HISTORY_FILE/,
    ],
    mustNotMatch: [/writeFileSync\(\s*LEGACY_HISTORY_FILE/],
  },
  {
    name: 'scrollback cache is instance-scoped and recover uses rename claim',
    file: 'src/services/scrollback-cache.service.ts',
    mustMatch: [
      /const CACHE_DIR = path\.join\(BASE_CACHE_DIR,\s*INSTANCE_ID\)/,
      /sessionKey\(sessionId:\s*string,\s*kind:\s*string,\s*cwd:\s*string\)/,
      /fs\.renameSync\(fp,\s*claimPath\)/,
    ],
  },
  {
    name: 'session persist uses session id and owner id for isolation',
    file: 'src/services/session-persist.service.ts',
    mustMatch: [
      /id:\s*string/,
      /ownerId:\s*string/,
      /RUNTIME_INSTANCE_ID/,
      /save\(kind:\s*string,\s*cwd:\s*string,\s*title:\s*string\):\s*string/,
      /removeById\(id:\s*string\)/,
      /removeMany\(ids:\s*string\[\]\)/,
      /getRecoverable\(\):\s*SavedSession\[\]/,
    ],
  },
  {
    name: 'recovery uses active run heartbeat instead of clean shutdown key',
    file: 'src/services/recovery.service.ts',
    mustMatch: [/ACTIVE_RUNS_KEY/, /RUN_HEARTBEAT_MS/, /getRecoverable\(/, /removeMany\(/],
    mustNotMatch: [/clean-shutdown/i, /sessionPersist\.clear\(\)/],
  },
  {
    name: 'deploy script does not write fixed debug.log',
    file: 'scripts/deploy.js',
    mustNotMatch: [/writeFileSync\([^)]*debug\.log/],
  },
  {
    name: 'browser panel does not push main content and resets stale layout state',
    file: 'src/ui/browser-panel.ts',
    mustMatch: [/resetStaleLayoutState\(\)/],
    mustNotMatch: [/agent-mux-browser-active \\.tab-body/, /margin-right:\s*var\(--agent-mux-browser-width/],
  },
]

const failures = []

for (const check of checks) {
  const content = read(check.file)
  for (const pattern of check.mustMatch || []) {
    if (!pattern.test(content)) {
      failures.push(`[${check.name}] missing pattern ${String(pattern)} in ${check.file}`)
    }
  }
  for (const pattern of check.mustNotMatch || []) {
    if (pattern.test(content)) {
      failures.push(`[${check.name}] forbidden pattern ${String(pattern)} found in ${check.file}`)
    }
  }
}

if (failures.length > 0) {
  console.error('Runtime guardrail check failed:')
  for (const msg of failures) {
    console.error(`- ${msg}`)
  }
  process.exit(1)
}

console.log('Runtime guardrail check passed.')
