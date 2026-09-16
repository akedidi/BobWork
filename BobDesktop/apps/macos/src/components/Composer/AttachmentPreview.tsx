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
  isDirectory?: boolean
  onRemove: () => void
}

const THUMB_SIZE = 56

export default function AttachmentPreview({ path, isDirectory = false, onRemove }: Props) {
  const t = useT()
  const [isDir, setIsDir] = useState(isDirectory)
  const [size, setSize] = useState<number | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    setIsDir(isDirectory)
    setPreviewFailed(false)
  }, [path, isDirectory])

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
  const extLabel = getFileTypeLabel(path) || t('composer.file').toUpperCase()
  const sizeLabel = isDir
    ? t('composer.folder')
    : size != null
      ? formatFileSize(size)
      : null

  return (
    <div
      className={`composer-attachment composer-attachment--${kind}${isImage ? ' composer-attachment--thumb' : ' composer-attachment--chip'}`}
      title={sizeLabel ? `${name} (${sizeLabel})` : name}
      data-testid="composer-attachment"
    >
      {isImage ? (
        <div className="composer-attachment-image">
          <img
            src={convertFileSrc(path)}
            alt={name}
            width={THUMB_SIZE}
            height={THUMB_SIZE}
            draggable={false}
            onError={() => setPreviewFailed(true)}
          />
        </div>
      ) : (
        <div className="composer-attachment-file">
          {isDir ? (
            <span className="composer-attachment-icon" aria-hidden="true">
              <Folder size={14} strokeWidth={1.75} />
            </span>
          ) : (
            <span className="composer-attachment-ext">{extLabel}</span>
          )}
          <div className="composer-attachment-meta">
            <span className="composer-attachment-name">{name}</span>
            {sizeLabel && <span className="composer-attachment-size">{sizeLabel}</span>}
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
        <X size={11} strokeWidth={2.5} />
      </button>
    </div>
  )
}

export { isImagePath }
