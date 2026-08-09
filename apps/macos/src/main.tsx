import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

function bootstrap() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
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
