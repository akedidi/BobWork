import { invoke } from '@tauri-apps/api/core'

export type BobInstallationStatus = 'BOB_NOT_INSTALLED' | 'BOB_READY'

export interface SessionApiKeyStatus {
  active: boolean
  source: 'session' | 'environment' | 'none'
}

class BobAuthService {
  async detectInstallation(): Promise<BobInstallationStatus> {
    try {
      const result = await invoke<{ found: boolean }>('detect_bob')
      return result.found ? 'BOB_READY' : 'BOB_NOT_INSTALLED'
    } catch {
      return 'BOB_NOT_INSTALLED'
    }
  }

  async getSessionApiKeyStatus(): Promise<SessionApiKeyStatus> {
    const [sessionActive, profile] = await Promise.all([
      invoke<boolean>('has_session_secret', { account: 'ibm_api_key' }),
      invoke<{ detection: { authenticated: boolean }; authenticationMethod: string }>('get_bob_profile', { workspace: null }),
    ])
    return {
      active: sessionActive || profile.detection.authenticated,
      source: sessionActive
        ? 'session'
        : profile.authenticationMethod === 'api_key_environment'
          ? 'environment'
          : 'none',
    }
  }

  async setSessionApiKey(secret: string): Promise<void> {
    await invoke('set_session_secret', { account: 'ibm_api_key', secret })
  }

  async clearSessionApiKey(): Promise<void> {
    await invoke('clear_session_secret', { account: 'ibm_api_key' })
  }
}

export const bobAuthService = new BobAuthService()
