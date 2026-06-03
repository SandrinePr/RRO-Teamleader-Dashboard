import fs from 'node:fs'
import path from 'node:path'

const src = path.resolve('dist')
const dest = path.resolve('api/wwwroot')

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('sync-wwwroot: run "npm run build" first (dist/index.html missing)')
  process.exit(1)
}

fs.mkdirSync(dest, { recursive: true })
for (const name of fs.readdirSync(dest)) {
  const from = path.join(src, name)
  const to = path.join(dest, name)
  fs.rmSync(to, { recursive: true, force: true })
  fs.cpSync(from, to, { recursive: true })
}

console.log('sync-wwwroot: dist → api/wwwroot')
