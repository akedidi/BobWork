import { useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { stat } from '@tauri-apps/plugin-fs'
import { Folder, X } from 'lucide-react'
import {
  formatFileSize,
  getFileName,
  getFileTypeLabel,
  getFileVisualKind,
  isImagePath,
} from './composerAttachments'
import { useT } from '../../i18n'

interface Props {
  path: string
  onRemove: () => void
}

export default function AttachmentPreview({ path, onRemove }: Props) {
  const t = useT()
  const [isDir, setIsDir] = useState(false)
  const [size, setSize] = useState<number | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    stat(path)
      .then(info => {
        if (cancelled) return
        setIsDir(info.isDirectory)
        setSize(info.isDirectory ? null : info.size)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [path])

  const name = getFileName(path)
  const kind = getFileVisualKind(path, isDir)
  const isImage = kind === 'image' && !previewFailed
  const extLabel = getFileTypeLabel(path, isDir)

  return (
    <div
      className={`composer-attachment composer-attachment--${kind}`}
      title={path}
      data-testid="composer-attachment"
    >
      {isImage ? (
        <div className="composer-attachment-image">
          <img
            src={convertFileSrc(path)}
            alt={name}
            width={72}
            height={72}
            draggable={false}
            onError={() => setPreviewFailed(true)}
          />
        </div>
      ) : isDir ? (
        <div className="composer-attachment-file">
          <span className="composer-attachment-icon" aria-hidden="true">
            <Folder size={18} strokeWidth={1.75} />
          </span>
          <div className="composer-attachment-meta">
            <span className="composer-attachment-name">{name}</span>
            <span className="composer-attachment-size">{t('composer.folder')}</span>
          </div>
        </div>
      ) : (
        <div className="composer-attachment-file">
          <span className="composer-attachment-ext">{extLabel}</span>
          <div className="composer-attachment-meta">
            <span className="composer-attachment-name">{name}</span>
            {size != null && <span className="composer-attachment-size">{formatFileSize(size)}</span>}
          </div>
        </div>
      )}
      <button
        type="button"
        aria-label={t('chat.remove')}
        className="composer-attachment-remove"
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          onRemove()
        }}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  )
}

export { isImagePath }
