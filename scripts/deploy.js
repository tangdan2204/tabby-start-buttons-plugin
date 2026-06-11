const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── Config ────────────────────────────────────────────────────
const PLUGIN_NAME = 'tabby-start-buttons'
const SOURCE = path.resolve(__dirname, '..')
const APPDATA_PLUGINS = path.join(process.env.APPDATA || '', 'tabby', 'plugins', 'node_modules', PLUGIN_NAME)
const BUILTIN_PLUGINS = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs', 'Tabby', 'resources', 'builtin-plugins', PLUGIN_NAME
)

// Tabby loads from builtin-plugins FIRST. If plugin exists there, APPDATA copy is ignored.
const PRIMARY_TARGET = BUILTIN_PLUGINS
const SECONDARY_TARGET = APPDATA_PLUGINS

// ─── Helpers ───────────────────────────────────────────────────
function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: SOURCE, encoding: 'utf-8' }).trim()
  } catch { return 'unknown' }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function copyDist(targetDir) {
  ensureDir(path.join(targetDir, 'dist'))
  fs.copyFileSync(
    path.join(SOURCE, 'dist', 'index.js'),
    path.join(targetDir, 'dist', 'index.js')
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
    JSON.stringify(deployPkg, null, 2), 'utf-8'
  )
  // Clear debug log on deploy
  fs.writeFileSync(path.join(targetDir, 'debug.log'), '', 'utf-8')
  return pkg.version
}

// ─── Main ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')

console.log('╔══════════════════════════════════════════╗')
console.log('║   Tabby Start-Buttons Deploy             ║')
console.log('╚══════════════════════════════════════════╝')

// Step 1: Build
if (!skipBuild) {
  console.log('\n[1/3] Building...')
  try {
    execSync('npx webpack --mode production', { cwd: SOURCE, stdio: 'pipe' })
    const stat = fs.statSync(path.join(SOURCE, 'dist', 'index.js'))
    console.log(`  ✓ dist/index.js (${(stat.size / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error('  ✗ Build failed:', e.stderr?.toString() || e.message)
    process.exit(1)
  }
} else {
  console.log('\n[1/3] Build skipped (--skip-build)')
  if (!fs.existsSync(path.join(SOURCE, 'dist', 'index.js'))) {
    console.error('  ✗ dist/index.js not found, run build first')
    process.exit(1)
  }
}

// Step 2: Deploy to PRIMARY target (builtin-plugins - this is what Tabby actually loads)
console.log('\n[2/3] Deploy to builtin-plugins (PRIMARY)...')
const builtinParent = path.dirname(PRIMARY_TARGET)
if (fs.existsSync(builtinParent)) {
  const ver = copyDist(PRIMARY_TARGET)
  console.log(`  ✓ ${PRIMARY_TARGET}`)
  console.log(`    version: ${ver}`)
} else {
  console.log(`  ✗ CRITICAL: ${builtinParent} not found!`)
  console.log(`    Tabby may not be installed in default location.`)
  process.exit(1)
}

// Step 3: Deploy to SECONDARY target (APPDATA - backup, lower priority)
console.log('\n[3/3] Deploy to APPDATA (SECONDARY)...')
const appdataParent = path.dirname(SECONDARY_TARGET)
if (fs.existsSync(appdataParent)) {
  copyDist(SECONDARY_TARGET)
  console.log(`  ✓ ${SECONDARY_TARGET}`)
} else {
  console.log(`  - skip: ${appdataParent} (not found)`)
}

// Write deploy manifest
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

console.log(`\n════════════════════════════════════════════`)
console.log(`  ✓ Deployed v${manifest.version} (${gitHash})`)
console.log(`  ⚠ Restart Tabby to load changes.`)
console.log(`════════════════════════════════════════════\n`)
