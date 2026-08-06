'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, portalFetch } from '../../../lib/auth';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useI18n } from '../../../lib/i18n/context';

const POLL_MS = 5000;

type Overview = {
  generatedAt?: string;
  health?: Record<string, unknown>;
  ready?: Record<string, unknown>;
  nodechain?: {
    tip?: { height?: number; tipHash?: string };
    chain?: { ok?: boolean; height?: number };
    recordCount?: number;
    killSwitch?: boolean;
    engine?: string;
  };
  processes?: {
    count: number;
    totalOnEdge: number;
    items: Array<{
      processId: string;
      status: string;
      institutionId: string;
      holderId: string;
      counterpartyIds: string[];
      valuation: string;
      fiatEvidenceCount: number;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  note?: string;
};

/**
 * Phase D — live ops control plane (operator role). Real APIs only.
 */
export default function OpsConsolePage() {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const s = loadSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (s.role !== 'operator') {
      setError(t('ops.forbidden'));
      setLoading(false);
      return;
    }
    try {
      const res = await portalFetch('/v1/ops/overview?limit=80', {
        sessionId: s.sessionId,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const nc = data?.nodechain;
  const tipH = nc?.tip?.height ?? nc?.chain?.height;
  const chainOk = nc?.chain?.ok;

  return (
    <div className="card">
      <p className="eyebrow" style={{ margin: 0 }}>
        {t('ops.eyebrow')}
      </p>
      <h1 style={{ marginTop: '0.25rem' }}>{t('ops.h1')}</h1>
      <p className="muted lead-wide">{t('ops.lead')}</p>

      {error && <p className="err">{error}</p>}
      {loading && !data && <p className="muted">{t('ops.loading')}</p>}

      {data && (
        <>
          <div className="grid2" style={{ marginBottom: '1rem' }}>
            <div className="card flat" style={{ margin: 0 }}>
              <div className="muted">{t('ops.nodechain')}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="mono">
                tip {tipH ?? '—'}
              </div>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                chain.ok: {String(chainOk ?? '—')} · engine: {String(nc?.engine ?? '—')} ·
                records: {String(nc?.recordCount ?? '—')} · killSwitch:{' '}
                {String(nc?.killSwitch ?? '—')}
              </p>
              {nc?.tip?.tipHash ? (
                <p className="mono" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                  {String(nc.tip.tipHash)}
                </p>
              ) : null}
              <Link href="/nodechain">
                <button type="button" className="secondary" style={{ marginTop: '0.5rem' }}>
                  {t('nav.nodechain')}
                </button>
              </Link>
            </div>
            <div className="card flat" style={{ margin: 0 }}>
              <div className="muted">{t('ops.stack')}</div>
              <pre className="result" style={{ maxHeight: 160, fontSize: '0.75rem' }}>
                {JSON.stringify(
                  {
                    health: data.health?.status ?? data.health,
                    ready: data.ready,
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                {t('ops.updated')}: {data.generatedAt ?? '—'} · {t('ops.poll')} {POLL_MS / 1000}s
              </p>
            </div>
          </div>

          <h2 style={{ fontSize: '1.1rem' }}>
            {t('ops.processes')} ({data.processes?.totalOnEdge ?? 0})
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.88rem' }}>
              <thead>
                <tr>
                  <th>processId</th>
                  <th>status</th>
                  <th>owner</th>
                  <th>holder</th>
                  <th>CPs</th>
                  <th>fiat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data.processes?.items ?? []).map((row) => (
                  <tr key={row.processId}>
                    <td className="mono" style={{ maxWidth: 220, wordBreak: 'break-all' }}>
                      {row.processId}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="mono">{row.institutionId}</td>
                    <td className="mono">{row.holderId}</td>
                    <td className="mono">{(row.counterpartyIds ?? []).join(', ') || '—'}</td>
                    <td>{row.fiatEvidenceCount}</td>
                    <td>
                      <Link
                        href={`/tokenization/${encodeURIComponent(row.processId)}`}
                      >
                        {t('ops.open')}
                      </Link>
                      {' · '}
                      <Link
                        href={`/nodechain?processId=${encodeURIComponent(row.processId)}`}
                      >
                        NC
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1rem' }}>
            {data.note}
          </p>
        </>
      )}
    </div>
  );
}
