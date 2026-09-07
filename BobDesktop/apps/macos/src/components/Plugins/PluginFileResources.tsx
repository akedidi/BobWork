import { useCallback, useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { PluginFileResource } from '@bob-work/shared-types'
import {
  deletePluginFileResource,
  listPluginFileResources,
  openPreviewResource,
  revealInFileManager,
  uploadPluginFileResource,
} from '../../lib/ipc'
import { errorMessage } from '../../lib/errorMessage'
import { formatFileSize } from '../Composer/composerAttachments'
import { useAppDialog } from '../AppDialog'
import { useT } from '../../i18n'

const FILE_FILTERS = [
  { name: 'Documents', extensions: ['pdf', 'xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'ods', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'json'] },
]

export function PluginFileResourcesSection({
  pluginId,
  revision,
  onStatus,
}: {
  pluginId: string
  revision: number
  onStatus: (message: string) => void
}) {
  const t = useT()
  const dialog = useAppDialog()
  const [files, setFiles] = useState<PluginFileResource[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setFiles(await listPluginFileResources(pluginId))
  }, [pluginId])

  useEffect(() => {
    void reload().catch(error => onStatus(errorMessage(error)))
  }, [pluginId, revision, reload, onStatus])

  const addFile = async () => {
    const selected = await open({ multiple: true, filters: FILE_FILTERS })
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
    if (paths.length === 0) return
    setBusy(true)
    try {
      for (const path of paths) {
        await uploadPluginFileResource(pluginId, path)
      }
      await reload()
      onStatus(t('plugins.addFile'))
    } catch (error) {
      onStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeFile = async (file: PluginFileResource) => {
    if (!(await dialog.confirm({
      message: t('plugins.deleteFile') + ` « ${file.fileName} » ?`,
      confirmLabel: t('common.delete'),
      destructive: true,
    }))) return
    await deletePluginFileResource(pluginId, file.id)
    await reload()
  }


  return (
    <>
      <section className="skill-detail-section" aria-label={t('plugins.fileResources')} data-testid="plugin-file-resources">
        <h3>{t('plugins.fileResources')}</h3>
        <p className="settings-note" style={{ marginTop: 0 }}>{t('plugins.fileResourcesNote')}</p>
        {files.length === 0 ? <p>{t('plugins.fileResourcesEmpty')}</p> : (
          <div className="plugin-mcp-list">
            {files.map(file => (
              <div className="plugin-mcp-card" key={file.id}>
                <div className="plugin-mcp-heading">
                  <strong>{file.fileName}</strong>
                  <span className="plugin-mcp-state">{file.kind.toUpperCase()}</span>
                </div>
                <p>{formatFileSize(file.size)}</p>
                <div className="settings-actions">
                  <button type="button" className="link-btn" onClick={() => void openPreviewResource(file.path)}>{t('plugins.openFile')}</button>
                  <button type="button" className="link-btn" onClick={() => void revealInFileManager(file.path)}>{t('plugins.revealFile')}</button>
                  <button type="button" className="danger-link" onClick={() => void removeFile(file)}>{t('plugins.deleteFile')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => void addFile()}>{t('plugins.addFile')}</button>
      </section>
    </>
  )
}
