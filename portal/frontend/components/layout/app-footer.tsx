'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '../../lib/i18n/context';

export function AppFooter() {
  const { t } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams();
  const isHome = pathname === '/';
  const isEmbed = search.get('embed') === '1';

  if (isHome || isEmbed) {
    return null;
  }

  return (
    <footer className="footer">
      <span className="footer-brand">
        <img
          className="footer-logo"
          src="/brand/ast-logo-dark.png"
          alt="Aros Studio Tokenomics"
          width={140}
          height={40}
        />
        <span>{t('footer.tagline')}</span>
      </span>
      <span>
        <Link href="/explore">{t('nav.explore')}</Link>
        {' · '}
        <Link href="/nodechain">{t('nav.nodechain')}</Link>
        {' · '}
        <Link href="/system">{t('nav.system')}</Link>
        {' · '}
        {t('footer.sot')}
      </span>
    </footer>
  );
}
