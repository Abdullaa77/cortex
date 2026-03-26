# Cortex v2 — Prompt 1 of 3: PWA Setup

## Context

Cortex is a personal Brain OS built with Next.js 16 + Tailwind v4 + Supabase, deployed on Vercel at cortex-sepia.vercel.app. This prompt makes it a proper installable PWA with offline support.

**Read the existing codebase first** — explore `src/app/layout.tsx`, `src/styles/globals.css`, `public/` folder, and `next.config.ts` before writing anything.

---

## What This Prompt Creates

```
public/
├── manifest.json            # Web app manifest
├── sw.js                    # Service worker
├── icons/
│   ├── icon-192.png         # Generated from SVG
│   ├── icon-512.png         # Generated from SVG
│   ├── icon-maskable-192.png
│   ├── icon-maskable-512.png
│   └── apple-touch-icon.png # 180x180
src/
├── components/
│   ├── providers/
│   │   └── PWAProvider.tsx  # Install prompt + SW registration + online/offline state
│   └── layout/
│       └── Header.tsx       # MODIFY — add sync indicator dot
├── app/
│   ├── layout.tsx           # MODIFY — add manifest link, PWAProvider, meta tags
│   └── offline/page.tsx     # Simple offline fallback page
```

---

## Step 1: App Icons

Generate simple terminal-themed icons. Since we can't use image tools, create an SVG icon and use it:

Create `public/icons/icon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="64" fill="#0A0A0F"/>
  <rect x="16" y="16" width="480" height="480" rx="48" fill="none" stroke="#00FF88" stroke-width="4" opacity="0.3"/>
  <text x="256" y="300" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="240" fill="#00FF88">C</text>
  <text x="256" y="420" text-anchor="middle" font-family="monospace" font-weight="600" font-size="72" fill="#00FF88" opacity="0.5">OS</text>
</svg>
```

Then generate PNG icons from this SVG. Use a build script or Node.js with `sharp` package:

```bash
npm install -D sharp
```

Create `scripts/generate-icons.js`:
```javascript
const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const outDir = path.join(__dirname, '..', 'public', 'icons');

async function generate() {
  const sizes = [192, 512];
  for (const size of sizes) {
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    
    // Maskable version (with padding — 80% safe zone)
    const padding = Math.floor(size * 0.1);
    await sharp(svgPath)
      .resize(size - padding * 2, size - padding * 2)
      .extend({
        top: padding, bottom: padding, left: padding, right: padding,
        background: { r: 10, g: 10, b: 15, alpha: 1 }
      })
      .png()
      .toFile(path.join(outDir, `icon-maskable-${size}.png`));
  }
  
  // Apple touch icon
  await sharp(svgPath)
    .resize(180, 180)
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
  
  console.log('Icons generated!');
}

generate();
```

Run it: `node scripts/generate-icons.js`

---

## Step 2: Web App Manifest

Create `public/manifest.json`:
```json
{
  "name": "Cortex — Brain OS",
  "short_name": "Cortex",
  "description": "Personal life operating system",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A0A0F",
  "theme_color": "#00FF88",
  "orientation": "any",
  "categories": ["productivity", "utilities"],
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-maskable-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

---

## Step 3: Service Worker

Create `public/sw.js`:

**Strategy:** Cache-first for app shell (HTML, CSS, JS, fonts), network-first for API calls (Supabase).

```javascript
const CACHE_NAME = 'cortex-v1';
const SHELL_ASSETS = [
  '/',
  '/inbox',
  '/projects',
  '/areas',
  '/ideas',
  '/offline',
  '/manifest.json',
];

// Install — cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip Supabase API calls — always network
  if (url.hostname.includes('supabase')) return;
  
  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;
  
  // For navigation requests — network first, fall back to cache, then offline page
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(event.request)
            .then((cached) => cached || caches.match('/offline'));
        })
    );
    return;
  }
  
  // For static assets (JS, CSS, images, fonts) — cache first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
  
  // Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
```

---

## Step 4: Offline Fallback Page

Create `src/app/offline/page.tsx`:

A simple page styled like the rest of Cortex:
```
── OFFLINE ──

> Connection lost.

You're offline. Cortex will sync when you're back online.
Your cached pages are still available.
```

- Dark bg, monospace, centered
- Green accent on the section header
- Muted text for the message
- No hooks, no data fetching — pure static

---

## Step 5: PWA Provider

Create `src/components/providers/PWAProvider.tsx`:

A client component that handles:

### 1. Service Worker Registration
```typescript
useEffect(() => {
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[Cortex] SW registered:', reg.scope);
        
        // Check for updates periodically
        setInterval(() => reg.update(), 60 * 60 * 1000); // every hour
        
        // Handle updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                // New version available — could show a toast, but for v1 just auto-refresh
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((err) => console.error('[Cortex] SW error:', err));
  }
}, []);
```

### 2. Online/Offline State
```typescript
const [isOnline, setIsOnline] = useState(true);

useEffect(() => {
  setIsOnline(navigator.onLine);
  
  const handleOnline = () => setIsOnline(true);
  const handleOffline = () => setIsOnline(false);
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, []);
```

Expose `isOnline` via context so Header can use it.

### 3. Install Prompt (deferred)
```typescript
const [installPrompt, setInstallPrompt] = useState<any>(null);
const [isInstallable, setIsInstallable] = useState(false);

useEffect(() => {
  const handler = (e: Event) => {
    e.preventDefault();
    setInstallPrompt(e);
    setIsInstallable(true);
  };
  
  window.addEventListener('beforeinstallprompt', handler);
  return () => window.removeEventListener('beforeinstallprompt', handler);
}, []);

const installApp = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const result = await installPrompt.userChoice;
  if (result.outcome === 'accepted') {
    setIsInstallable(false);
    setInstallPrompt(null);
  }
};
```

Expose `isInstallable` and `installApp` via context.

### Context Shape
```typescript
interface PWAContextType {
  isOnline: boolean;
  isInstallable: boolean;
  installApp: () => Promise<void>;
}
```

---

## Step 6: Layout Updates

### `src/app/layout.tsx`
Add to `<head>`:
```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#00FF88" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

Wrap children in PWAProvider (inside SupabaseProvider).

### Metadata export
Update the Next.js metadata export to include:
```typescript
export const metadata: Metadata = {
  title: 'Cortex — Brain OS',
  description: 'Personal life operating system',
  manifest: '/manifest.json',
  themeColor: '#00FF88',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cortex',
  },
};
```

Note: Check if Next.js 16 handles manifest/themeColor in metadata export or if it needs to be in the HTML head manually. Use whichever approach works.

---

## Step 7: Header — Sync Indicator

### Modify `src/components/layout/Header.tsx`

Add a small colored dot next to the time display:
- **Green dot** (pulsing slowly): online, synced — `bg-accent` with pulse animation
- **Red dot**: offline — `bg-red-500`
- Size: 6px circle
- Tooltip on hover: "Online" / "Offline"

Use `usePWA()` hook from PWAProvider to get `isOnline`.

Also, if `isInstallable` is true, show a small "Install" button in the header (or next to Settings in sidebar):
- Monospace, small, green border, muted text
- Clicking calls `installApp()`
- Disappears after installed or dismissed

---

## Step 8: next.config.ts

Add headers for the service worker:
```typescript
async headers() {
  return [
    {
      source: '/sw.js',
      headers: [
        {
          key: 'Cache-Control',
          value: 'no-cache, no-store, must-revalidate',
        },
        {
          key: 'Service-Worker-Allowed',
          value: '/',
        },
      ],
    },
  ];
}
```

---

## Verification

1. `npm run build` passes
2. Icons generated in `public/icons/` (5 PNG files)
3. `manifest.json` exists and is valid (check with Chrome DevTools → Application → Manifest)
4. Service worker registers in production (check DevTools → Application → Service Workers)
5. Offline page renders when you disconnect (DevTools → Network → Offline checkbox, then navigate)
6. Sync indicator dot shows in header (green when online)
7. In Chrome, "Install app" option appears in address bar or the Install button shows
8. After install, app opens in standalone window with dark theme color
9. Static assets load from cache on second visit (check Network tab — "(from service worker)")
10. No errors in console related to SW or manifest

## Skills to Use
- Use **verification-before-completion** to check all 10 items
- Use **systematic-debugging** if SW doesn't register or cache doesn't work

## Files Created
- `public/manifest.json`
- `public/sw.js`
- `public/icons/icon.svg`
- `public/icons/icon-192.png` (generated)
- `public/icons/icon-512.png` (generated)
- `public/icons/icon-maskable-192.png` (generated)
- `public/icons/icon-maskable-512.png` (generated)
- `public/icons/apple-touch-icon.png` (generated)
- `scripts/generate-icons.js`
- `src/components/providers/PWAProvider.tsx`
- `src/app/offline/page.tsx`

## Files Modified
- `src/app/layout.tsx` — manifest link, PWAProvider, meta tags
- `src/components/layout/Header.tsx` — sync dot, install button
- `next.config.ts` — SW headers

## DO NOT
- Install next-pwa or serwist — hand-written SW is simpler and we control exactly what's cached
- Add offline mutation queuing (deferred — too complex for now, just show offline state)
- Modify any hooks or data logic
- Break existing functionality
