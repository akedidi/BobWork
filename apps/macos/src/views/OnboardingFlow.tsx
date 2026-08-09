import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import { bobAuthService, BobInstallationStatus } from '../services/BobAuthService'
import { useAppStore } from '../stores/appStore'
import { errorMessage } from '../lib/errorMessage'

type Step = 'SETUP' | 'INSTALLING' | 'SUCCESS' | 'ERROR'

export default function OnboardingFlow() {
  const [step, setStep] = useState<Step>('SETUP')
  const [installation, setInstallation] = useState<BobInstallationStatus | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [apiKey, setApiKey] = useState('')
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
      await invoke('install_bob_shell')
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
    } catch (error) {
      setErrorMsg(errorMessage(error))
    }
  }

  return (
    <div style={{ padding: 48, maxWidth: 600, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
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
              aria-label="Clé API IBM Bob"
              placeholder="Clé d’inférence IBM Bob"
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
          <button style={primaryButtonStyle} onClick={() => navigate('/')}>Continuer</button>
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
  )
}

const primaryButtonStyle = { padding: '12px 24px', background: '#0f62fe', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }
const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '11px 12px', marginBottom: 12, border: '1px solid #c6c6c6', borderRadius: 6 }
