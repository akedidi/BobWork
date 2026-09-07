import { useT } from '../../i18n'
import { Heading } from './SettingsShared'
import { RuntimeStorageCard } from './RuntimeStorageCard'

export default function RuntimesSettingsTab({ setStatus }: { setStatus: (message: string) => void }) {
  const t = useT()

  return (
    <>
      <Heading title={t('settings.runtimesHeading')} description={t('settings.runtimesDesc')} />
      <RuntimeStorageCard setStatus={setStatus} />
    </>
  )
}
