import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const updaterPublicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim()

if (!updaterPublicKey) {
  throw new Error('TAURI_UPDATER_PUBLIC_KEY is required for a release build')
}
if (!signingIdentity) {
  throw new Error('APPLE_SIGNING_IDENTITY is required for a notarized macOS release')
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
        'https://github.com/akedidi/BobWork/releases/latest/download/latest.json',
      ],
    },
  },
}

const output = fileURLToPath(new URL('../src-tauri/tauri.release.conf.json', import.meta.url))
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
console.log(`Release config created at ${output}`)
