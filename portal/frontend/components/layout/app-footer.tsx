'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '../../lib/i18n/context';

export function AppFooter() {
  const { t } = useI18n();
  const search = useSearchParams();
  const isEmbed = search.get('embed') === '1';

  if (isEmbed) {
    return null;
  }

  return (
    <footer className="footer">
      <span className="footer-brand">
        <img
          className="footer-logo"
          src="/brand/ast-logo-light.png"
          alt="Aros Studio Tokenomics"
          width={140}
          height={40}
        />
        <span>{t('footer.tagline')}</span>
      </span>
      <span>
        <Link href="/nodechain">{t('nav.nodechain')}</Link>
        {' · '}
        <Link href="/login">{t('nav.login')}</Link>
        {' · '}
        {t('footer.sot')}
      </span>
    </footer>
  );
}
