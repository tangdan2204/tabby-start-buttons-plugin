const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ALLOWED_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.html',
  '.yml',
  '.yaml',
])

const IGNORE_DIR = new Set([
  '.git',
  'node_modules',
  'dist',
  '.omx',
  '.playwright-mcp',
])

function collectFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIR.has(entry.name)) continue
      collectFiles(full, out)
      continue
    }
    const ext = path.extname(entry.name).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) continue
    out.push(full)
  }
  return out
}

function verifyUtf8(filePath) {
  const buf = fs.readFileSync(filePath)
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    return 'detected UTF-16 BOM'
  }
  if (buf.includes(0x00)) {
    return 'detected NUL byte'
  }
  const text = buf.toString('utf-8')
  if (text.includes('\uFFFD')) {
    return 'detected replacement char (possible mojibake/invalid utf-8)'
  }
  return null
}

const files = collectFiles(ROOT)
const failures = []

for (const filePath of files) {
  const error = verifyUtf8(filePath)
  if (error) {
    failures.push(`${path.relative(ROOT, filePath)}: ${error}`)
  }
}

if (failures.length > 0) {
  console.error('UTF-8 guard check failed:')
  for (const item of failures) {
    console.error(`- ${item}`)
  }
  process.exit(1)
}

console.log(`UTF-8 guard check passed (${files.length} files).`)
