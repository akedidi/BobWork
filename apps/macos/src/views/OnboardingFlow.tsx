import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { bobAuthService, BobInstallationStatus } from '../services/BobAuthService'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../lib/errorMessage'
import { getSettings, installBobShell, updateSettings } from '../lib/ipc'
import { requestStartupPermissions } from '../lib/startupPermissions'
import { useT } from '../i18n'

type Step = 'SETUP' | 'INSTALLING' | 'SUCCESS' | 'ERROR'

export default function OnboardingFlow() {
  const t = useT()
  const [step, setStep] = useState<Step>('SETUP')
  const [installation, setInstallation] = useState<BobInstallationStatus | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enableComputerUse, setEnableComputerUse] = useState(false)
  const [enableChrome, setEnableChrome] = useState(false)
  const { setBobStatus } = useAppStore()
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      bobAuthService.detectInstallation(),
      bobAuthService.getSessionApiKeyStatus(),
    ]).then(([nextInstallation, authentication]) => {
      setInstallation(nextInstallation)
      if (authentication.active) {
        setBobStatus('ready')
        setStep('SUCCESS')
        void requestStartupPermissions()
      }
    }).catch(error => {
      setErrorMsg(errorMessage(error, 'Impossible de vérifier la configuration locale.'))
      setStep('ERROR')
    })
  }, [setBobStatus])

  const installBob = async () => {
    setStep('INSTALLING')
    setErrorMsg('')
    try {
      await installBobShell()
      setInstallation('BOB_READY')
      setStep('SETUP')
    } catch (error) {
      setErrorMsg(errorMessage(error, 'L’installation de Bob Shell a échoué.'))
      setStep('ERROR')
    }
  }

  const activateApiKey = async () => {
    if (installation !== 'BOB_READY' || !apiKey.trim()) return
    setErrorMsg('')
    try {
      await bobAuthService.setSessionApiKey(apiKey.trim())
      setApiKey('')
      setBobStatus('ready')
      setStep('SUCCESS')
      void requestStartupPermissions()
    } catch (error) {
      setErrorMsg(errorMessage(error))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="topbar titlebar-drag" data-tauri-drag-region style={{ height: 48, flexShrink: 0 }} />
      <div style={{ padding: 48, maxWidth: 600, margin: '0 auto', fontFamily: 'system-ui, sans-serif', flex: 1, overflow: 'auto' }}>
      {step === 'SETUP' && (
        <div className="onboarding-step">
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>Configurer IBM Bob</h1>
          <p style={{ color: '#555', marginBottom: 18, lineHeight: 1.6 }}>
            Bob Work utilise <code>bob run</code> pour les conversations, projets, tâches et planifications. La clé est enregistrée dans un coffre local chiffré sur ce Mac, sans Trousseau macOS.
          </p>

          {installation === null && <p style={{ color: '#6f6f6f' }}>Vérification de Bob Shell…</p>}

          {installation === 'BOB_NOT_INSTALLED' && <>
            <p style={{ color: '#555', marginBottom: 16 }}>Bob Shell doit d’abord être installé sur ce Mac.</p>
            <button style={primaryButtonStyle} onClick={installBob}>Installer Bob Shell</button>
          </>}

          {installation === 'BOB_READY' && <>
            <input
              type="password"
              autoFocus
              aria-label={t('onboarding.apiKeyLabel')}
              placeholder={t('onboarding.apiKeyLabel')}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              style={inputStyle}
            />
            <button
              style={primaryButtonStyle}
              onClick={activateApiKey}
              disabled={!apiKey.trim()}
            >
              Enregistrer dans le coffre
            </button>
            <p style={{ color: '#6f6f6f', fontSize: 12, marginTop: 12 }}>
              Aucun login SSO et aucun Trousseau macOS. La clé reste chiffrée localement et disponible après redémarrage de Bob Work.
            </p>
          </>}

          {errorMsg && <p style={{ color: '#da1e28', fontSize: 13 }}>{errorMsg}</p>}
        </div>
      )}

      {step === 'INSTALLING' && (
        <div className="onboarding-step">
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>Installation de Bob Shell</h1>
          <p style={{ color: '#555' }}>Téléchargement de la version officielle et vérification de son intégrité…</p>
        </div>
      )}

      {step === 'SUCCESS' && (
        <div className="onboarding-step">
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>IBM Bob est prêt</h1>
          <p style={{ color: '#555', marginBottom: 24 }}>
            Bob Work peut maintenant exécuter les conversations, projets, tâches et planifications avec <code>bob run</code>.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, fontSize: 13, color: '#333' }}>
            <input type="checkbox" checked={enableComputerUse} onChange={event => setEnableComputerUse(event.target.checked)} />
            Activer Computer Use (MCP bob-work-computer-use + Accessibilité)
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 18, fontSize: 13, color: '#333' }}>
            <input type="checkbox" checked={enableChrome} onChange={event => setEnableChrome(event.target.checked)} />
            Activer le contrôle Chrome (MCP + Automatisation)
          </label>
          <button style={primaryButtonStyle} onClick={() => {
            void (async () => {
              if (enableComputerUse || enableChrome) {
                try {
                  const current = await getSettings()
                  await updateSettings({
                    ...current,
                    computerUseEnabled: enableComputerUse || current.computerUseEnabled,
                    chromeControlEnabled: enableChrome || current.chromeControlEnabled,
                  })
                } catch {
                  /* settings remain available in Réglages */
                }
              }
              navigate('/')
            })()
          }}>Continuer</button>
        </div>
      )}

      {step === 'ERROR' && (
        <div className="onboarding-step">
          <h1 style={{ fontSize: 24, marginBottom: 16, color: '#da1e28' }}>Configuration impossible</h1>
          <p style={{ color: '#555', marginBottom: 24 }}>{errorMsg}</p>
          <button style={primaryButtonStyle} onClick={() => setStep('SETUP')}>Réessayer</button>
        </div>
      )}
      </div>
    </div>
  )
}

const primaryButtonStyle = { padding: '12px 24px', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }
const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '11px 12px', marginBottom: 12, border: '1px solid #c6c6c6', borderRadius: 6 }
