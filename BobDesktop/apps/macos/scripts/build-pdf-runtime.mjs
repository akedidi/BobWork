import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const source = dirname(require.resolve('pdfjs-dist/package.json'))
const target = resolve(import.meta.dirname, '../public/runtime-pdf')
mkdirSync(target, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(resolve(source, directory), resolve(target, directory), { recursive: true })
}
cpSync(resolve(source, 'LICENSE'), resolve(target, 'LICENSE'))
