#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tauriDir = join(appDir, 'src-tauri')
const packageVersion = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version
const tauriConfig = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
const cargoToml = readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8')
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]

if (!cargoVersion || packageVersion !== cargoVersion || packageVersion !== tauriConfig.version) {
  throw new Error(`Release versions differ: package=${packageVersion}, Cargo=${cargoVersion}, Tauri=${tauriConfig.version}`)
}

const explicitBundle = process.argv[2]
const targetDir = resolve(process.env.CARGO_TARGET_DIR || join(tauriDir, 'target'))
const bundle = resolve(explicitBundle || join(targetDir, 'release/bundle/macos/Bob Work.app'))
const executable = join(bundle, 'Contents/MacOS/bob-work')
const plist = join(bundle, 'Contents/Info.plist')
for (const required of [bundle, executable, plist]) statSync(required)

const plistValue = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim()
if (plistValue('CFBundleIdentifier') !== tauriConfig.identifier) throw new Error('Unexpected release bundle identifier')
if (plistValue('CFBundleShortVersionString') !== packageVersion) throw new Error('The packaged version does not match the sources')

const forbiddenNames = [/\.map$/i, /\.dSYM$/i, /vite\.svg$/i, /tauri\.svg$/i]
const files = []
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(bundle)
const forbidden = files.filter(path => forbiddenNames.some(pattern => pattern.test(path)))
if (forbidden.length) throw new Error(`Development artifacts leaked into release: ${forbidden.join(', ')}`)

const binary = readFileSync(executable)
for (const marker of ['EXPO_PUBLIC_BOB_MOBILE_DEV_SCREEN', 'VITE_BOB_WORK_E2E', 'tauri-plugin-wdio']) {
  if (binary.includes(Buffer.from(marker))) throw new Error(`Development marker found in release executable: ${marker}`)
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const manifest = {
  schemaVersion: 1,
  product: tauriConfig.productName,
  version: packageVersion,
  identifier: tauriConfig.identifier,
  generatedAt: new Date().toISOString(),
  bundle: basename(bundle),
  executableSha256: sha256(executable),
  files: files.map(path => ({ path: path.slice(bundle.length + 1), size: statSync(path).size, sha256: sha256(path) })),
}
const manifestPath = resolve(process.env.BOB_WORK_RELEASE_MANIFEST || join(targetDir, 'release/bob-work-release-manifest.json'))
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Release bundle certified: ${bundle}`)
console.log(`Version: ${packageVersion}; files: ${files.length}; manifest: ${manifestPath}`)
