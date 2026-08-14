import { useEffect } from 'react'
import { checkForUpdates, installAvailableUpdate } from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { useAppDialog } from './AppDialog'
import { useT } from '../i18n'

/** Checks once per launch; failures stay silent because local/dev builds have no release channel. */
export function UpdateController() {
  const dialog = useAppDialog()
  const t = useT()

  useEffect(() => {
    let disposed = false
    const timer = window.setTimeout(() => {
      void (async () => {
        let installing = false
        try {
          const update = await checkForUpdates()
          if (disposed || !update.available || !update.version) return
          const accepted = await dialog.confirm({
            title: t('settings.updatePromptTitle'),
            message: t('settings.updatePromptMessage', { version: update.version }),
            confirmLabel: t('settings.installAndRestart'),
          })
          if (!accepted || disposed) return
          installing = true
          await installAvailableUpdate()
        } catch (error) {
          // Only surface installation failures. A missing endpoint is expected in local builds.
          if (!disposed && installing) {
            await dialog.alert({ message: errorMessage(error, t('settings.updateInstallFailed')) })
          }
        }
      })()
    }, 10_000)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [dialog, t])

  return null
}
