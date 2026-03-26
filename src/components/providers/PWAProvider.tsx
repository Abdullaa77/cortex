'use client';

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAContextType {
  isOnline: boolean;
  isInstallable: boolean;
  installApp: () => Promise<void>;
}

const PWAContext = createContext<PWAContextType>({
  isOnline: true,
  isInstallable: false,
  installApp: async () => {},
});

export function usePWA() {
  return useContext(PWAContext);
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getOnlineServerSnapshot() {
  return true;
}

// Store install prompt outside React to avoid state-in-effect issues
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function subscribeInstall(callback: () => void) {
  installListeners.add(callback);

  const handler = (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    installListeners.forEach((cb) => cb());
  };

  window.addEventListener('beforeinstallprompt', handler);
  return () => {
    installListeners.delete(callback);
    window.removeEventListener('beforeinstallprompt', handler);
  };
}

function getInstallSnapshot() {
  return deferredPrompt !== null;
}

function getInstallServerSnapshot() {
  return false;
}

export function PWAProvider({ children }: { children: ReactNode }) {
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const isInstallable = useSyncExternalStore(subscribeInstall, getInstallSnapshot, getInstallServerSnapshot);

  // Service Worker registration
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          console.log('[Cortex] SW registered:', reg.scope);

          // Check for updates periodically
          setInterval(() => reg.update(), 60 * 60 * 1000);

          // Handle updates
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'activated') {
                  window.location.reload();
                }
              });
            }
          });
        })
        .catch((err) => console.error('[Cortex] SW error:', err));
    }
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      deferredPrompt = null;
      installListeners.forEach((cb) => cb());
    }
  };

  return (
    <PWAContext.Provider value={{ isOnline, isInstallable, installApp }}>
      {children}
    </PWAContext.Provider>
  );
}
