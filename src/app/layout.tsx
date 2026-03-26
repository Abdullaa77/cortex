import type { Metadata } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import { SupabaseProvider } from '@/components/providers/SupabaseProvider';
import { InboxProvider } from '@/components/providers/InboxProvider';
import { PWAProvider } from '@/components/providers/PWAProvider';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Cortex — Brain OS',
  description: 'Personal life operating system',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cortex',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${jetbrainsMono.variable} ${inter.variable}`}>
      <head>
        <meta name="theme-color" content="#00FF88" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body>
        <SupabaseProvider>
          <PWAProvider>
            <InboxProvider>{children}</InboxProvider>
          </PWAProvider>
        </SupabaseProvider>
      </body>
    </html>
  );
}
