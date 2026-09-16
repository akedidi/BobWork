#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url))
const readJson = name => JSON.parse(readFileSync(new URL(name, `file://${tauriDir}`), 'utf8'))
const expectedEndpoint = 'https://github.com/akedidi/BobWork/releases/latest/download/latest.json'
const base = readJson('tauri.conf.json')
const updater = base.plugins?.updater

if (!updater?.pubkey?.trim()) throw new Error('The production updater public key is empty')
if (!updater.endpoints?.includes(expectedEndpoint)) {
  throw new Error(`The production updater endpoint must include ${expectedEndpoint}`)
}

const releasePath = new URL('tauri.release.conf.json', `file://${tauriDir}`)
if (existsSync(releasePath)) {
  const release = JSON.parse(readFileSync(releasePath, 'utf8'))
  if (release.plugins?.updater?.pubkey !== updater.pubkey) {
    throw new Error('Base and release updater public keys differ')
  }
  if (release.bundle?.createUpdaterArtifacts !== true) {
    throw new Error('The release config must create signed updater artifacts')
  }
}

console.log('Updater configuration verified')
