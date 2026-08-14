import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'

type ModalOverlayProps = {
  onClose: () => void
  children: ReactNode
  /** Ignore backdrop clicks while saving, etc. */
  closeOnBackdrop?: boolean
  /** Defaults to the backdrop policy so a busy modal cannot be dismissed accidentally. */
  closeOnEscape?: boolean
  zIndex?: number
  className?: string
  /** Optional explicit focus target restored when the modal closes. */
  restoreFocusTo?: RefObject<HTMLElement | null>
}

type ModalPanelProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  role?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/** Full-screen dimmed backdrop; click outside the panel to dismiss. */
export function ModalOverlay({
  onClose,
  children,
  closeOnBackdrop = true,
  closeOnEscape = closeOnBackdrop,
  zIndex,
  className,
  restoreFocusTo,
}: ModalOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const overlay = overlayRef.current
    const focusable = overlay?.querySelector<HTMLElement>(
      '[autofocus], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    window.requestAnimationFrame(() => (focusable ?? overlay)?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (!overlayRef.current) return
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(overlayRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ))
      if (items.length === 0) {
        event.preventDefault()
        overlayRef.current.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      ;(restoreFocusTo?.current ?? previouslyFocused)?.focus()
    }
  }, [closeOnEscape, restoreFocusTo])

  return (
    <div
      ref={overlayRef}
      className={['modal-overlay', className].filter(Boolean).join(' ')}
      style={zIndex !== undefined ? { zIndex } : undefined}
      role="presentation"
      tabIndex={-1}
      onMouseDown={event => {
        if (event.target !== event.currentTarget) return
        if (closeOnBackdrop) onClose()
      }}
    >
      {children}
    </div>
  )
}

/** Modal content; stops backdrop clicks from bubbling to `ModalOverlay`. */
export function ModalPanel({
  children,
  className,
  style,
  role = 'dialog',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}: ModalPanelProps) {
  return (
    <div
      className={className}
      style={style}
      role={role}
      aria-modal={role === 'dialog' || role === 'alertdialog' ? true : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-describedby={ariaDescribedby}
      onMouseDown={event => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
