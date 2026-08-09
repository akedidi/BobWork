import { chmod, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(tmpdir(), 'bob-work-e2e')
const data = resolve(root, 'data')
const home = resolve(root, 'home')
const fakeBob = resolve(import.meta.dirname, 'fixtures', 'fake-bob')

if (!root.startsWith(resolve(tmpdir()) + '/')) {
  throw new Error(`Refusing to prepare E2E directory outside the system temp folder: ${root}`)
}

await rm(root, { recursive: true, force: true })
await mkdir(data, { recursive: true })
await mkdir(home, { recursive: true })
await chmod(fakeBob, 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'mcp-echo-server.py'), 0o755)
