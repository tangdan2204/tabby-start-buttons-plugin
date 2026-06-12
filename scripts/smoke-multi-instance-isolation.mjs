import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const SCRIPT_PATH = path.resolve(process.argv[1])

async function workerMode(root, indexRaw, roundsRaw) {
  const index = Number(indexRaw)
  const rounds = Number(roundsRaw)
  const pidToken = process.pid.toString(36)
  const runToken = Math.random().toString(36).slice(2, 8)

  const historyDir = path.join(root, 'history')
  const logDir = path.join(root, 'logs')
  const scrollbackDir = path.join(root, 'scrollback', pidToken)

  await fs.mkdir(historyDir, { recursive: true })
  await fs.mkdir(logDir, { recursive: true })
  await fs.mkdir(scrollbackDir, { recursive: true })

  const historyFile = path.join(historyDir, `history-${pidToken}-${runToken}.json`)
  const logFile = path.join(logDir, `debug-${pidToken}.log`)
  const scrollbackFile = path.join(scrollbackDir, `codex_repo_${index}.scrollback`)
  const cwd = `D:/repo-${index}`
  const kind = index % 2 === 0 ? 'codex' : 'claude'

  let history = []
  for (let i = 0; i < rounds; i++) {
    history = normalizeHistory([
      { kind, cwd, ts: Date.now() + i },
      ...history,
    ])
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2), 'utf-8')
    await fs.appendFile(logFile, `[${new Date().toISOString()}] worker=${index} round=${i}\n`, 'utf-8')
    await fs.writeFile(scrollbackFile, `worker=${index}\nround=${i}\n`, 'utf-8')
  }

  process.stdout.write(JSON.stringify({
    mode: 'worker',
    worker: index,
    historyFile,
    logFile,
    scrollbackFile,
    historyItems: history.length,
  }))
}

async function claimMode(root) {
  const baseDir = path.join(root, 'scrollback')
  const claimed = []
  if (!fsSync.existsSync(baseDir)) {
    process.stdout.write(JSON.stringify({ mode: 'claim', claimed }))
    return
  }

  const dirs = await fs.readdir(baseDir)
  for (const dirName of dirs) {
    const dirPath = path.join(baseDir, dirName)
    let files = []
    try {
      files = await fs.readdir(dirPath)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.scrollback')) continue
      const src = path.join(dirPath, file)
      const dst = `${src}.claim.${process.pid.toString(36)}.${Date.now().toString(36)}`
      try {
        await fs.rename(src, dst)
        claimed.push(dst)
      } catch {
        // Another process claimed this file first.
      }
    }
  }

  process.stdout.write(JSON.stringify({ mode: 'claim', claimed }))
}

function normalizeHistory(entries) {
  const dedup = new Map()
  for (const entry of entries) {
    if (!entry || typeof entry.kind !== 'string' || typeof entry.cwd !== 'string' || typeof entry.ts !== 'number') {
      continue
    }
    const key = `${entry.kind}\n${entry.cwd}`
    const prev = dedup.get(key)
    if (!prev || prev.ts < entry.ts) {
      dedup.set(key, entry)
    }
  }
  return Array.from(dedup.values())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20)
}

function spawnJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`child exited with ${code}\n${stderr}`))
        return
      }
      try {
        const payload = JSON.parse(stdout.trim())
        resolve(payload)
      } catch (error) {
        reject(new Error(`invalid JSON output: ${stdout}\n${stderr}\n${error.message}`))
      }
    })
  })
}

async function parentMode() {
  const workers = Number(process.env.SMOKE_WORKERS || 4)
  const rounds = Number(process.env.SMOKE_ROUNDS || 32)
  const root = path.join(
    os.tmpdir(),
    `tabby-agent-mux-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  )

  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })

  const workerResults = await Promise.all(
    Array.from({ length: workers }, (_, i) => spawnJson(['--worker', root, String(i), String(rounds)])),
  )

  const historyFiles = workerResults.map(r => r.historyFile)
  const uniqueHistoryFiles = new Set(historyFiles)
  if (uniqueHistoryFiles.size !== workers) {
    throw new Error(`history file collision detected: expected ${workers}, got ${uniqueHistoryFiles.size}`)
  }

  for (const file of historyFiles) {
    const parsed = JSON.parse(await fs.readFile(file, 'utf-8'))
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`history file invalid or empty: ${file}`)
    }
  }

  const logDir = path.join(root, 'logs')
  const logs = await fs.readdir(logDir)
  if (logs.includes('debug.log')) {
    throw new Error('legacy debug.log detected in smoke workspace')
  }
  if (logs.length !== workers) {
    throw new Error(`unexpected log file count: expected ${workers}, got ${logs.length}`)
  }

  const claimResults = await Promise.all([
    spawnJson(['--claim', root]),
    spawnJson(['--claim', root]),
  ])

  const claimed = claimResults.flatMap(r => r.claimed || [])
  const claimedBaseNames = claimed.map(fp => path.basename(fp).split('.claim.')[0])
  const uniqueClaimed = new Set(claimedBaseNames)
  if (uniqueClaimed.size !== workers) {
    throw new Error(`claim coverage mismatch: expected ${workers}, got ${uniqueClaimed.size}`)
  }
  if (claimedBaseNames.length !== uniqueClaimed.size) {
    throw new Error('duplicate scrollback claim detected')
  }

  process.stdout.write(
    [
      'Multi-instance isolation smoke passed.',
      `workspace=${root}`,
      `workers=${workers}`,
      `rounds=${rounds}`,
      `historyFiles=${uniqueHistoryFiles.size}`,
      `logFiles=${logs.length}`,
      `claimed=${uniqueClaimed.size}`,
    ].join('\n'),
  )
}

const [mode, a, b, c] = process.argv.slice(2)

if (mode === '--worker') {
  await workerMode(a, b, c)
} else if (mode === '--claim') {
  await claimMode(a)
} else {
  await parentMode()
}
