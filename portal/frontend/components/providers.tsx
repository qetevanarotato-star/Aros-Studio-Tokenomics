'use client';

import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { I18nProvider } from '../lib/i18n/context';
import { EmbedShell } from './embed-shell';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <Suspense fallback={null}>
        <EmbedShell />
      </Suspense>
      {children}
    </I18nProvider>
  );
}
