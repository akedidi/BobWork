import { invoke } from '@tauri-apps/api/core'
import type { BobAuthSnapshot } from '@bob-work/shared-types'

export type BobInstallationStatus = 'BOB_NOT_INSTALLED' | 'BOB_READY'

export interface SessionApiKeyStatus {
  active: boolean
  source: 'session' | 'environment' | 'sso' | 'none'
  vaultKeyPresent: boolean
}

export function resolveSessionApiKeyStatus(
  snapshot: Pick<BobAuthSnapshot, 'authenticated' | 'authenticationMethod'> | null,
  vaultKeyPresent: boolean,
): SessionApiKeyStatus {
  const vault = vaultKeyPresent || snapshot?.authenticationMethod === 'api_key_session'
  if (vault) {
    return { active: true, source: 'session', vaultKeyPresent: true }
  }
  if (snapshot?.authenticationMethod === 'api_key_environment') {
    return { active: true, source: 'environment', vaultKeyPresent: false }
  }
  if (snapshot?.authenticationMethod === 'sso_session_detected') {
    return { active: true, source: 'sso', vaultKeyPresent: false }
  }
  if (snapshot?.authenticated) {
    return { active: true, source: 'sso', vaultKeyPresent: false }
  }
  return { active: false, source: 'none', vaultKeyPresent: false }
}

class BobAuthService {
  async getAuthSnapshot(): Promise<BobAuthSnapshot> {
    return invoke<BobAuthSnapshot>('get_bob_auth_snapshot')
  }

  async detectInstallation(): Promise<BobInstallationStatus> {
    try {
      const snapshot = await this.getAuthSnapshot()
      return snapshot.found ? 'BOB_READY' : 'BOB_NOT_INSTALLED'
    } catch {
      return 'BOB_NOT_INSTALLED'
    }
  }

  async getSessionApiKeyStatus(): Promise<SessionApiKeyStatus> {
    const [sessionActive, snapshot] = await Promise.all([
      invoke<boolean>('has_session_secret', { account: 'ibm_api_key' }).catch(() => false),
      this.getAuthSnapshot().catch(() => ({
        found: false,
        authenticated: false,
        authenticationMethod: 'required',
      } satisfies BobAuthSnapshot)),
    ])
    return resolveSessionApiKeyStatus(snapshot, sessionActive)
  }

  async setSessionApiKey(secret: string): Promise<void> {
    await invoke('set_session_secret', { account: 'ibm_api_key', secret })
  }

  async clearSessionApiKey(): Promise<void> {
    await invoke('clear_session_secret', { account: 'ibm_api_key' })
  }
}

export const bobAuthService = new BobAuthService()
