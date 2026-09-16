import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const updaterPublicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim()

if (!updaterPublicKey) {
  throw new Error('TAURI_UPDATER_PUBLIC_KEY is required for a release build')
}
if (!signingIdentity) {
  throw new Error('APPLE_SIGNING_IDENTITY is required for a signed macOS release')
}

const baseConfigPath = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url))
const baseConfig = JSON.parse(readFileSync(baseConfigPath, 'utf8'))
const embeddedPublicKey = baseConfig.plugins?.updater?.pubkey?.trim()
const embeddedEndpoints = baseConfig.plugins?.updater?.endpoints ?? []
const expectedEndpoint = 'https://github.com/akedidi/BobWork/releases/latest/download/latest.json'

if (!embeddedPublicKey || embeddedPublicKey !== updaterPublicKey) {
  throw new Error('TAURI_UPDATER_PUBLIC_KEY must match the key embedded in tauri.conf.json')
}
if (!embeddedEndpoints.includes(expectedEndpoint)) {
  throw new Error(`tauri.conf.json must include updater endpoint ${expectedEndpoint}`)
}

const config = {
  bundle: {
    createUpdaterArtifacts: true,
    macOS: { signingIdentity },
  },
  plugins: {
    updater: {
      pubkey: updaterPublicKey,
      endpoints: [
        expectedEndpoint,
      ],
    },
  },
}

const output = fileURLToPath(new URL('../src-tauri/tauri.release.conf.json', import.meta.url))
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
console.log(`Release config created at ${output}`)
