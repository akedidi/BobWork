import { ArrowDownCircle } from 'lucide-react'
import { useAppDialog } from './AppDialog'
import { useT } from '../i18n'
import { errorMessage } from '../lib/errorMessage'
import { useUpdateStore } from '../stores/updateStore'

export function UpdateButton() {
  const t = useT()
  const dialog = useAppDialog()
  const available = useUpdateStore(state => state.available)
  const version = useUpdateStore(state => state.version)
  const notes = useUpdateStore(state => state.notes)
  const installing = useUpdateStore(state => state.installing)
  const install = useUpdateStore(state => state.install)

  if (!available || !version) return null

  const label = t('nav.updateAvailable', { version })

  const onClick = async () => {
    const message = notes?.trim()
      ? `${t('settings.updatePromptMessage', { version })}\n\n${notes.trim()}\n\n${t('settings.updatePreserveData')}`
      : `${t('settings.updatePromptMessage', { version })}\n\n${t('settings.updatePreserveData')}`
    const accepted = await dialog.confirm({
      title: t('settings.updatePromptTitle'),
      message,
      confirmLabel: t('settings.installAndRestart'),
    })
    if (!accepted) return
    try {
      await install()
    } catch (error) {
      await dialog.alert({ message: errorMessage(error, t('settings.updateInstallFailed')) })
    }
  }

  return (
    <button
      type="button"
      className="sidebar-update-btn"
      aria-label={label}
      title={label}
      disabled={installing}
      onClick={() => void onClick()}
    >
      <ArrowDownCircle size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
