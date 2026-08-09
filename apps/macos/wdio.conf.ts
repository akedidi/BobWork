import type { Options } from '@wdio/types'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const e2eRoot = resolve(tmpdir(), 'bob-work-e2e')

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./e2e/specs/**/*.e2e.ts'],
  maxInstances: 1,
  services: [[
    '@wdio/tauri-service',
    {
      driverProvider: 'embedded',
      embeddedPort: 4445,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      startTimeout: 90_000,
      env: {
        HOME: resolve(e2eRoot, 'home'),
        BOB_WORK_E2E_DATA_DIR: resolve(e2eRoot, 'data'),
        BOB_WORK_BOB_PATH: resolve(import.meta.dirname, 'e2e', 'fixtures', 'fake-bob'),
        RUST_LOG: 'bob_work=debug,tauri=warn',
      },
    },
  ]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: resolve(import.meta.dirname, 'src-tauri', 'target', 'e2e', 'release', 'bob-work'),
    },
  }],
  // The embedded macOS provider does not use tauri-driver. Service 1.3 still
  // diagnoses that external binary and logs a false error even when tests pass.
  logLevel: 'silent',
  bail: 1,
  waitforTimeout: 12_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },
}
