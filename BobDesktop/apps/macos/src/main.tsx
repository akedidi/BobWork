import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import { AppDialogProvider } from './components/AppDialog';
import { warmSettingsCache } from './lib/ipc';
import './index.css';

// Warm settings before first navigation so Settings never waits on a cold IPC.
warmSettingsCache();

function bootstrap() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <AppDialogProvider>
          <App />
        </AppDialogProvider>
      </I18nProvider>
    </React.StrictMode>
  );

  if (import.meta.env.VITE_BOB_WORK_E2E === '1') {
    void import('@wdio/tauri-plugin').catch((error) => {
      console.error('[E2E] Impossible d’initialiser le pont WebdriverIO', error);
    });
  }
}
bootstrap();

// Désactiver le menu contextuel natif (Reload, Inspect) 
// sauf pour les champs de texte où l'on veut pouvoir faire copier-coller
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  if (
    target.tagName === 'INPUT' || 
    target.tagName === 'TEXTAREA' || 
    target.isContentEditable
  ) {
    return;
  }
  e.preventDefault();
});
