import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import '../styles/globals.css';
import { AppHeader } from '../components/layout/app-header';
import { AppFooter } from '../components/layout/app-footer';
import { Providers } from '../components/providers';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Aros Studio Tokenomics (AST) — Institutional Portal',
    template: '%s · AST',
  },
  description:
    'Institutional portal for Aros Studio Tokenomics (AST). Edge admission → Core Orchestrator. No mint on the portal.',
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <div className="shell">
            <Suspense fallback={null}>
              <AppHeader />
            </Suspense>
            <main className="shell-main">{children}</main>
            <Suspense fallback={null}>
              <AppFooter />
            </Suspense>
          </div>
        </Providers>
      </body>
    </html>
  );
}
