import { useCallback, useState } from 'react'
import type { DbConnection, SaveDbConnectionInput } from '@bob-work/shared-types'
import {
  deleteDbConnection,
  getDbConnections,
  saveDbConnection,
  setDbConnectionEnabled,
  testDbConnection,
} from '../lib/ipc'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../i18n'

export function useDbConnections({ setStatus }: { setStatus: (s: string) => void }) {
  const t = useT()
  const [connections, setConnections] = useState<DbConnection[]>([])
  const [testBusy, setTestBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setConnections(await getDbConnections())
  }, [])

  const persist = useCallback(async (input: SaveDbConnectionInput) => {
    const saved = await saveDbConnection(input)
    await load()
    setStatus(t('integrations.savedNamed', { name: saved.name }))
    return saved
  }, [load, setStatus, t])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    await setDbConnectionEnabled(id, enabled)
    await load()
  }, [load])

  const remove = useCallback(async (id: string, name: string) => {
    await deleteDbConnection(id)
    await load()
    setStatus(t('integrations.deletedNamed', { name }))
  }, [load, setStatus, t])

  const test = useCallback(async (id: string, name: string) => {
    setTestBusy(id)
    try {
      const result = await testDbConnection(id)
      setStatus(result.ok ? `${name} : ${result.message}` : `${name} — échec : ${result.message}`)
      await load()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setTestBusy(null)
    }
  }, [load, setStatus, t])

  return { connections, load, persist, toggle, remove, test, testBusy }
}
