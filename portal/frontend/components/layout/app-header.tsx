'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  clearSession,
  loadSession,
  portalFetch,
  type PortalSession,
} from '../../lib/auth';
import { useI18n } from '../../lib/i18n/context';
import { LanguageSwitcher } from './language-switcher';

export function AppHeader() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { t } = useI18n();
  const isHome = pathname === '/';
  /** Framer (or any host) embeds portal under their chrome — hide Next header */
  const isEmbed = search.get('embed') === '1';

  useEffect(() => {
    if (isHome || isEmbed) return;
    setSession(loadSession());
  }, [pathname, isHome, isEmbed]);

  function logout() {
    const s = loadSession();
    if (s) {
      void portalFetch('/v1/auth/logout', {
        method: 'POST',
        sessionId: s.sessionId,
      });
    }
    clearSession();
    setSession(null);
    router.push('/login');
  }

  // Home owns its own nav (Canva layout) — global header off
  if (isHome || isEmbed) {
    return null;
  }

  return (
    <header className="topbar">
      <Link href="/" className="brand-link" aria-label="Aros Studio Tokenomics">
        <div className="brand">
          <img
            className="brand-logo"
            src="/brand/ast-logo-dark.png"
            alt="Aros Studio Tokenomics"
            width={280}
            height={80}
          />
        </div>
      </Link>
      <div className="topbar-right">
        <LanguageSwitcher />
        <nav className="nav" aria-label="Main">
          <Link href="/nodechain">{t('nav.nodechain')}</Link>
          <Link href="/system">{t('nav.system')}</Link>
          <Link href="/about">{t('nav.about')}</Link>
          {session ? (
            <>
              <Link href="/dashboard">{t('nav.cabinet')}</Link>
              <Link href="/tokenization">{t('nav.tokenization')}</Link>
              <Link href="/assets">{t('nav.assets')}</Link>
              <span className="pill">{session.institutionId}</span>
              <button type="button" className="linkish" onClick={logout}>
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <Link href="/login" className="nav-login">
              {t('nav.login')}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
