#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tauriDir = join(appDir, 'src-tauri')
const packageVersion = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version
const tauriConfigFile = process.env.BOB_WORK_TAURI_CONFIG || 'tauri.conf.json'
const baseTauriConfig = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(join(tauriDir, tauriConfigFile), 'utf8'))
const productName = tauriConfig.productName || baseTauriConfig.productName || 'Bob Work'
const expectedIdentifier = tauriConfig.identifier || baseTauriConfig.identifier
const expectedVersion = tauriConfig.version || baseTauriConfig.version
const expectedMainBinary =
  tauriConfig.mainBinaryName || baseTauriConfig.mainBinaryName || null
const expectedBundleName =
  tauriConfig.bundle?.macOS?.bundleName
  || baseTauriConfig.bundle?.macOS?.bundleName
  || productName
const cargoToml = readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8')
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1]

if (!cargoVersion || packageVersion !== cargoVersion || packageVersion !== expectedVersion) {
  throw new Error(`Release versions differ: package=${packageVersion}, Cargo=${cargoVersion}, Tauri=${expectedVersion}`)
}
if (!/^custom-protocol\s*=\s*\[\s*["']tauri\/custom-protocol["']\s*\]/m.test(cargoToml)) {
  throw new Error('Cargo feature custom-protocol must enable tauri/custom-protocol for production bundles')
}

const explicitBundle = process.argv[2]
const targetDir = resolve(process.env.CARGO_TARGET_DIR || join(tauriDir, 'target'))
const bundle = resolve(explicitBundle || join(targetDir, `release/bundle/macos/${productName}.app`))
const isTestBundle = expectedIdentifier?.endsWith('.test') || /test/i.test(productName)
const executableName = expectedMainBinary || (isTestBundle ? 'bob-work-test' : 'bob-work')
const forbiddenSiblingExecutable = isTestBundle ? 'bob-work' : 'bob-work-test'
const executable = join(bundle, `Contents/MacOS/${executableName}`)
const siblingExecutable = join(bundle, `Contents/MacOS/${forbiddenSiblingExecutable}`)
const plist = join(bundle, 'Contents/Info.plist')
for (const required of [bundle, executable, plist]) statSync(required)
if (existsSync(siblingExecutable)) {
  throw new Error(
    `Bundle must not ship sibling executable ${forbiddenSiblingExecutable} (macOS TCC/Automation conflation risk)`,
  )
}

const bundleExecutable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], { encoding: 'utf8' }).trim()
if (bundleExecutable !== executableName) {
  throw new Error(`CFBundleExecutable is ${bundleExecutable}, expected ${executableName}`)
}

execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' })
const requirementCheck = spawnSync(
  '/usr/bin/codesign',
  ['--display', '--requirements', '-', bundle],
  { encoding: 'utf8' },
)
if (requirementCheck.status !== 0) {
  throw new Error(`Unable to read release signature requirement: ${requirementCheck.stderr.trim()}`)
}
const designatedRequirement = `${requirementCheck.stdout}\n${requirementCheck.stderr}`.trim()
if (/\bcdhash\b/i.test(designatedRequirement)) {
  throw new Error('Release bundle has an unstable ad-hoc cdhash identity; macOS TCC permissions would be lost after an update')
}

const plistValue = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim()
if (plistValue('CFBundleIdentifier') !== expectedIdentifier) throw new Error('Unexpected release bundle identifier')
if (plistValue('CFBundleShortVersionString') !== packageVersion) throw new Error('The packaged version does not match the sources')
if (plistValue('CFBundleName') !== expectedBundleName) {
  throw new Error(`CFBundleName is ${plistValue('CFBundleName')}, expected ${expectedBundleName}`)
}
const displayName = (() => {
  try {
    return plistValue('CFBundleDisplayName')
  } catch {
    return productName
  }
})()
if (displayName !== productName) {
  throw new Error(`CFBundleDisplayName is ${displayName}, expected ${productName}`)
}
for (const key of ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSAppleEventsUsageDescription']) {
  const value = plistValue(key)
  if (!value) throw new Error(`Release Info.plist is missing ${key}`)
  if (isTestBundle && !/Bob Work-test/i.test(value)) {
    throw new Error(`${key} must mention Bob Work-test for the test bundle`)
  }
  if (!isTestBundle && /Bob Work-test/i.test(value)) {
    throw new Error(`${key} must not mention Bob Work-test for the release bundle`)
  }
}
if (isTestBundle && expectedMainBinary !== 'bob-work-test') {
  throw new Error('tauri.test.conf.json must set mainBinaryName to bob-work-test')
}
if (!isTestBundle && expectedMainBinary && expectedMainBinary !== 'bob-work') {
  throw new Error('tauri.conf.json must set mainBinaryName to bob-work')
}

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
