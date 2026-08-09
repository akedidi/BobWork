// ============================================================
// Bob Work – MainLayout
// Shell principal + ApprovalOverlay câblé en temps réel
// ============================================================

import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { listen } from '@tauri-apps/api/event'
import Sidebar from '../Sidebar/Sidebar'
import { ApprovalOverlay } from '../Approval/ApprovalOverlay'
import { useAppStore } from '../../stores/appStore'
import { getPendingApprovals, getSettings } from '../../lib/ipc'
import type { Approval, AppSettings } from '@bob-work/shared-types'

export default function MainLayout() {
  const { pendingApprovals, setPendingApprovals, addApproval } = useAppStore((s) => ({
    pendingApprovals: s.pendingApprovals,
    setPendingApprovals: s.setPendingApprovals,
    addApproval: (a: Approval) => s.setPendingApprovals([...s.pendingApprovals, a]),
  }))

  // ── Load pending approvals on mount ────────────────────────
  useEffect(() => {
    getPendingApprovals()
      .then(setPendingApprovals)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    let current: AppSettings | null = null
    const apply = (settings: AppSettings) => {
      current = settings
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion)
      document.documentElement.style.fontSize = `${settings.fontSize}px`
      document.documentElement.lang = settings.language === 'auto' ? navigator.language.split('-')[0] : settings.language
    }
    getSettings().then(apply).catch(() => {})
    const onSystemTheme = () => current && apply(current)
    const onSettings = (event: Event) => apply((event as CustomEvent<AppSettings>).detail)
    media.addEventListener('change', onSystemTheme)
    window.addEventListener('bob-settings-updated', onSettings)
    return () => { media.removeEventListener('change', onSystemTheme); window.removeEventListener('bob-settings-updated', onSettings) }
  }, [])

  // ── Listen for real-time approval events from Bob ──────────
  useEffect(() => {
    let unlisten: (() => void) | null = null

    listen<Approval>('approval-required', (event) => {
      addApproval(event.payload)
    }).then(fn => { unlisten = fn })

    return () => { unlisten?.() }
  }, [])

  // ── Top pending approval (shown as blocking overlay) ───────
  const topApproval = pendingApprovals.find(a => a.decision === 'pending')

  return (
    <div className="app-shell">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="main-content">
        <Outlet />
      </div>

      {/* Approval overlay — blocks interaction when Bob needs a decision */}
      {topApproval && (
        <ApprovalOverlay approval={topApproval} />
      )}
    </div>
  )
}
