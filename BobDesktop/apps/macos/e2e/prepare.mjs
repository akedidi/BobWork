import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
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
const canvas = resolve(data, 'live-canvas')
await mkdir(resolve(canvas, 'styles'), { recursive: true })
await writeFile(resolve(canvas, 'styles', 'app.css'), 'body{margin:0;background:#08111f;color:#eef;padding:24px;font-family:system-ui}.wide{width:1200px}.spacer{height:1400px}')
await writeFile(resolve(canvas, 'index.html'), `<!doctype html><html><head><script src="https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.min.js"></script><link rel="stylesheet" href="styles/app.css"></head><body><h1>Canvas Bob Work E2E</h1><div id="three-status">initialisation</div><div class="wide">zone horizontale</div><div class="spacer"></div><script>document.getElementById('three-status').textContent=window.THREE?'Three.js local actif':'Three.js absent'</script></body></html>`)
const codegraphProject = resolve(data, 'codegraph-project')
await mkdir(resolve(codegraphProject, 'src'), { recursive: true })
await writeFile(resolve(codegraphProject, 'src', 'orders.ts'), 'export function totalOrder(lines: number[]) { return lines.reduce((a,b)=>a+b,0) }\nexport function checkout(lines: number[]) { return totalOrder(lines) }\n')
await chmod(fakeBob, 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'mcp-echo-server.py'), 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'mcp-integration-hub.py'), 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'mcp-computer-use.py'), 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'mcp-chrome-control.py'), 0o755)
await chmod(resolve(import.meta.dirname, 'fixtures', 'bin', 'ssh'), 0o755)
