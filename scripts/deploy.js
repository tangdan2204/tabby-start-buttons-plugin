const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const PLUGIN_NAME = 'tabby-start-buttons'
const SOURCE = path.resolve(__dirname, '..')
const APPDATA_PLUGINS = path.join(process.env.APPDATA || '', 'tabby', 'plugins', 'node_modules', PLUGIN_NAME)
const BUILTIN_PLUGINS = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'Tabby',
  'resources',
  'builtin-plugins',
  PLUGIN_NAME,
)

// Tabby loads from builtin-plugins first. If plugin exists there, APPDATA copy is ignored.
const PRIMARY_TARGET = BUILTIN_PLUGINS
const SECONDARY_TARGET = APPDATA_PLUGINS

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: SOURCE, encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function cleanupLegacyLog(targetDir) {
  // Runtime logger now uses per-process debug-<pid>.log files.
  // Keep deploy idempotent by removing stale legacy debug.log if it exists.
  const legacyLog = path.join(targetDir, 'debug.log')
  if (!fs.existsSync(legacyLog)) return
  const archived = path.join(targetDir, `debug-legacy-${Date.now().toString(36)}.log`)
  try {
    fs.renameSync(legacyLog, archived)
  } catch {
    try { fs.unlinkSync(legacyLog) } catch {}
  }
}

function copyDist(targetDir) {
  ensureDir(path.join(targetDir, 'dist'))
  fs.copyFileSync(
    path.join(SOURCE, 'dist', 'index.js'),
    path.join(targetDir, 'dist', 'index.js'),
  )

  const pkg = JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf-8'))
  const deployPkg = {
    name: PLUGIN_NAME,
    version: pkg.version,
    description: pkg.description,
    keywords: ['tabby-plugin'],
    main: 'dist/index.js',
    author: pkg.author,
    license: pkg.license,
  }

  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(deployPkg, null, 2),
    'utf-8',
  )
  cleanupLegacyLog(targetDir)
  return pkg.version
}

const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')

console.log('============================================')
console.log('  Tabby Start-Buttons Deploy')
console.log('============================================')

console.log('\n[0/4] Guardrail check...')
try {
  execSync('node scripts/check-runtime-guardrails.js', { cwd: SOURCE, stdio: 'pipe' })
  console.log('  OK Runtime guardrails passed')
} catch (e) {
  console.error('  FAIL Runtime guardrails failed:', e.stderr?.toString() || e.message)
  process.exit(1)
}

if (!skipBuild) {
  console.log('\n[1/4] Building...')
  try {
    execSync('npx webpack --mode production', { cwd: SOURCE, stdio: 'pipe' })
    const stat = fs.statSync(path.join(SOURCE, 'dist', 'index.js'))
    console.log(`  OK dist/index.js (${(stat.size / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error('  FAIL Build failed:', e.stderr?.toString() || e.message)
    process.exit(1)
  }
} else {
  console.log('\n[1/4] Build skipped (--skip-build)')
  if (!fs.existsSync(path.join(SOURCE, 'dist', 'index.js'))) {
    console.error('  FAIL dist/index.js not found, run build first')
    process.exit(1)
  }
}

console.log('\n[2/4] Deploy to builtin-plugins (PRIMARY)...')
const builtinParent = path.dirname(PRIMARY_TARGET)
if (fs.existsSync(builtinParent)) {
  const ver = copyDist(PRIMARY_TARGET)
  console.log(`  OK ${PRIMARY_TARGET}`)
  console.log(`     version: ${ver}`)
} else {
  console.log(`  FAIL CRITICAL: ${builtinParent} not found`)
  console.log('       Tabby may not be installed in default location.')
  process.exit(1)
}

console.log('\n[3/4] Deploy to APPDATA (SECONDARY)...')
const appdataParent = path.dirname(SECONDARY_TARGET)
if (fs.existsSync(appdataParent)) {
  copyDist(SECONDARY_TARGET)
  console.log(`  OK ${SECONDARY_TARGET}`)
} else {
  console.log(`  SKIP ${appdataParent} (not found)`)
}

const gitHash = getGitHash()
const manifest = {
  deployedAt: new Date().toISOString(),
  version: JSON.parse(fs.readFileSync(path.join(SOURCE, 'package.json'), 'utf-8')).version,
  gitHash,
  source: SOURCE,
  primaryTarget: PRIMARY_TARGET,
  secondaryTarget: SECONDARY_TARGET,
}
try {
  fs.writeFileSync(path.join(PRIMARY_TARGET, '.deploy-info'), JSON.stringify(manifest, null, 2), 'utf-8')
} catch {}

console.log('\n[4/4] Deployment manifest...')
console.log('  OK .deploy-info updated')

console.log('\n============================================')
console.log(`  OK Deployed v${manifest.version} (${gitHash})`)
console.log('  WARN Restart Tabby to load changes.')
console.log('============================================\n')
