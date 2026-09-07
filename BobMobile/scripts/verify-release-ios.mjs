#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo
const bundle = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-release-ios.mjs /path/to/BobMobile.app')
const plist = join(bundle, 'Info.plist')
statSync(plist)

const plistValue = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim()
if (plistValue('CFBundleIdentifier') !== config.ios.bundleIdentifier) throw new Error('Unexpected iOS bundle identifier')
if (plistValue('CFBundleShortVersionString') !== config.version) throw new Error('The iOS bundle version does not match app.json')

const executableName = plistValue('CFBundleExecutable')
const executable = join(bundle, executableName)
statSync(executable)
const forbidden = []
const files = []
const walk = directory => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (/\.dSYM$/i.test(name)) forbidden.push(path)
      else walk(path)
    } else {
      files.push(path)
      if (/\.map$/i.test(name)) forbidden.push(path)
      if (/\.debug\.dylib$|__preview\.dylib$|expo-dev-(client|launcher|menu)/i.test(path)) forbidden.push(path)
    }
  }
}
walk(bundle)
if (forbidden.length) throw new Error(`Development artifacts leaked into iOS release: ${forbidden.join(', ')}`)

for (const marker of ['expo-development-client', 'localhost:8081', 'EXPO_PUBLIC_BOB_MOBILE_DEV_SCREEN']) {
  if (files.some(path => readFileSync(path).includes(Buffer.from(marker)))) {
    throw new Error(`Development marker found in iOS release: ${marker}`)
  }
}

// Expo's optimized JS bundle contains the symbol name EXDevLauncher in its
// generic exception bridge even when expo-dev-client is not linked. Treat it
// as a leak only when it appears in native executable/framework content.
const nativeFiles = files.filter(path => !path.endsWith('/main.jsbundle'))
if (nativeFiles.some(path => readFileSync(path).includes(Buffer.from('EXDevLauncher')))) {
  throw new Error('Native EXDevLauncher component found in iOS release')
}

// The location feature is part of the product contract. Its absence catches the
// exact stale-prebuild regression where JS referenced ExpoLocation but the old
// native application had never linked it.
const hasExpoLocation = files.some(path => path.includes('ExpoLocation.framework') || readFileSync(path).includes(Buffer.from('ExpoLocation')))
if (!hasExpoLocation) throw new Error('ExpoLocation is missing from the native release bundle')

console.log(`iOS Release bundle certified: ${bundle}`)
console.log(`Version: ${config.version}; identifier: ${config.ios.bundleIdentifier}`)
