'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiBase } from '../../lib/auth';
import { StatusBadge } from '../../components/ui/status-badge';
import { useI18n } from '../../lib/i18n/context';

/**
 * Public process explorer — no login, no institution key.
 * Supports deep link: /explore?processId=AST-…
 */
function ExplorePageInner() {
  const { t } = useI18n();
  const search = useSearchParams();
  const qProcessId = search.get('processId') ?? search.get('pid') ?? '';
  const [processId, setProcessId] = useState(qProcessId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const lookup = useCallback(async (idRaw: string) => {
    const id = idRaw.trim();
    if (!id) {
      setError(t('explore.err.empty'));
      return;
    }
    setBusy(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(
        `${apiBase()}/v1/public/processes/${encodeURIComponent(id)}`,
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? res.statusText);
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (qProcessId.trim()) {
      setProcessId(qProcessId);
      void lookup(qProcessId);
    }
  }, [qProcessId, lookup]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await lookup(processId);
  }

  return (
    <>
      <section className="card hero">
        <p className="eyebrow">{t('explore.eyebrow')}</p>
        <h1>{t('explore.h1')}</h1>
        <p className="lead lead-wide">{t('explore.lead')}</p>
      </section>

      <div className="card">
        <form onSubmit={onSubmit}>
          <label htmlFor="pid">{t('explore.label')}</label>
          <input
            id="pid"
            className="mono"
            value={processId}
            onChange={(e) => setProcessId(e.target.value)}
            placeholder="AST-…"
            autoComplete="off"
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t('explore.searching') : t('explore.search')}
            </button>
            <Link href="/nodechain">
              <button type="button" className="secondary">
                {t('explore.cta.nc')}
              </button>
            </Link>
            <Link href="/system">
              <button type="button" className="ghost">
                {t('explore.cta.why')}
              </button>
            </Link>
          </div>
        </form>
        {error && <p className="err">{error}</p>}
      </div>

      {data && (
        <div className="card">
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <StatusBadge status={String(data.status)} />
            <span className="badge info">
              {t('explore.source')}: {String(data.source ?? '—')}
            </span>
            {data.public === true && (
              <span className="badge ok">{t('explore.public')}</span>
            )}
          </div>
          <h2 style={{ wordBreak: 'break-all' }}>{String(data.processId ?? processId)}</h2>
          {data.holderWallet != null && String(data.holderWallet).length > 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              {t('cert.walletField')}:{' '}
              <code className="mono">{String(data.holderWallet)}</code>
            </p>
          ) : null}
          <pre className="result">{JSON.stringify(data, null, 2)}</pre>
          <div className="actions">
            <Link href={`/nodechain?processId=${encodeURIComponent(String(data.processId ?? processId))}`}>
              <button type="button" className="secondary">
                {t('nav.nodechain')}
              </button>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">…</p></div>}>
      <ExplorePageInner />
    </Suspense>
  );
}
