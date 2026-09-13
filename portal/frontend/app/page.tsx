'use client';

import Link from 'next/link';
import { useI18n } from '../lib/i18n/context';

/**
 * Home — same dark high-tech shell as cabinet / NodeChain.
 * CTAs: NodeChain + Login only. Language lives in the shared header.
 */
export default function HomePage() {
  const { t } = useI18n();

  return (
    <div className="home-stage">
      <img
        className="home-logo reveal"
        src="/brand/ast-logo-light.png"
        alt="a. Aros Studio Tokenomics"
        width={520}
        height={280}
      />

      <h1 className="home-h1 reveal d1">{t('home.h1')}</h1>

      <p className="home-lead reveal d2">
        {t('home.lead.before')}
        <strong>NodeChain</strong>
        {t('home.lead.after')}
      </p>

      <div className="home-ctas reveal d3">
        <Link href="/nodechain" className="btn">
          {t('home.cta.nodechain')}
        </Link>
        <Link href="/login" className="btn secondary">
          {t('home.cta.cabinet')}
        </Link>
      </div>
    </div>
  );
}
