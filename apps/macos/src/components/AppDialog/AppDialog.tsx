import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ModalOverlay, ModalPanel } from '../ModalOverlay'
import { useT } from '../../i18n'

export interface ConfirmDialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface AlertDialogOptions {
  title?: string
  message: string
  acknowledgeLabel?: string
}

interface DialogApi {
  confirm: (options: ConfirmDialogOptions | string) => Promise<boolean>
  alert: (options: AlertDialogOptions | string) => Promise<void>
}

type PendingDialog =
  | { kind: 'confirm'; options: ConfirmDialogOptions; resolve: (accepted: boolean) => void }
  | { kind: 'alert'; options: AlertDialogOptions; resolve: () => void }

const unavailableDialogApi: DialogApi = {
  confirm: async () => false,
  alert: async () => undefined,
}

const AppDialogContext = createContext<DialogApi>(unavailableDialogApi)

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [current, setCurrent] = useState<PendingDialog | null>(null)
  const queueRef = useRef<PendingDialog[]>([])
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  const showNext = useCallback(() => {
    setCurrent(queueRef.current.shift() ?? null)
  }, [])

  const finishConfirm = useCallback((accepted: boolean) => {
    if (!current || current.kind !== 'confirm') return
    current.resolve(accepted)
    showNext()
  }, [current, showNext])

  const finishAlert = useCallback(() => {
    if (!current || current.kind !== 'alert') return
    current.resolve()
    showNext()
  }, [current, showNext])

  const enqueue = useCallback((dialog: PendingDialog) => {
    setCurrent(existing => {
      if (existing) {
        queueRef.current.push(dialog)
        return existing
      }
      return dialog
    })
  }, [])

  const confirm = useCallback<DialogApi['confirm']>(options => new Promise(resolve => {
    enqueue({
      kind: 'confirm',
      options: typeof options === 'string' ? { message: options } : options,
      resolve,
    })
  }), [enqueue])

  const alert = useCallback<DialogApi['alert']>(options => new Promise(resolve => {
    enqueue({
      kind: 'alert',
      options: typeof options === 'string' ? { message: options } : options,
      resolve,
    })
  }), [enqueue])

  useEffect(() => {
    if (!current) return
    primaryButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (current.kind === 'confirm') finishConfirm(false)
      else finishAlert()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [current, finishAlert, finishConfirm])

  const api = useMemo<DialogApi>(() => ({ confirm, alert }), [alert, confirm])

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      {current && (
        <ModalOverlay
          className="app-dialog-overlay"
          zIndex={4000}
          closeOnEscape={false}
          onClose={() => current.kind === 'confirm' ? finishConfirm(false) : finishAlert()}
        >
          <ModalPanel
            className="app-dialog"
            role="alertdialog"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
          >
            <h2 id="app-dialog-title">
              {current.options.title ?? (current.kind === 'confirm' ? t('dialog.confirmTitle') : t('dialog.alertTitle'))}
            </h2>
            <p id="app-dialog-message">{current.options.message}</p>
            <div className="app-dialog-actions">
              {current.kind === 'confirm' && (
                <button type="button" className="secondary-btn" onClick={() => finishConfirm(false)}>
                  {current.options.cancelLabel ?? t('common.cancel')}
                </button>
              )}
              <button
                ref={primaryButtonRef}
                autoFocus
                type="button"
                className={current.kind === 'confirm' && current.options.destructive ? 'danger-btn' : 'primary-btn'}
                onClick={() => current.kind === 'confirm' ? finishConfirm(true) : finishAlert()}
              >
                {current.kind === 'confirm'
                  ? current.options.confirmLabel ?? t('dialog.confirm')
                  : current.options.acknowledgeLabel ?? t('dialog.ok')}
              </button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      )}
    </AppDialogContext.Provider>
  )
}

export function useAppDialog(): DialogApi {
  return useContext(AppDialogContext)
}
