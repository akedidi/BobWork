import {
  getNotificationAuthState,
  getSettings,
  isNotificationAuthGranted,
  requestNotificationAuthorization,
} from './ipc'

/**
 * Permissions requested at launch.
 * Notifications are asked immediately; Accessibility / Automation stay
 * on-demand when Computer Use or Chrome Control is enabled later.
 */
export async function requestStartupPermissions(): Promise<void> {
  try {
    const settings = await getSettings()
    if (!settings.notificationsEnabled) return
    const state = await getNotificationAuthState()
    if (isNotificationAuthGranted(state) || state === 'denied' || state === 'unavailable') return
    await requestNotificationAuthorization()
  } catch {
    /* best-effort — user can retry from Settings */
  }
}
