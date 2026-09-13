'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, portalFetch } from '../../../lib/auth';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useI18n } from '../../../lib/i18n/context';

interface ProcessRow {
  processId: string;
  status: string;
  processType: string;
  valuation: string;
  holderId: string;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  submittedToCore: number;
  awaitingCore: number;
  lastSubmittedAt: string | null;
  byStatus: Record<string, number>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [rows, setRows] = useState<ProcessRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [coreOk, setCoreOk] = useState<boolean | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const s = loadSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setInstitutionId(s.institutionId);
    setDisplayName(s.displayName);
    setError(null);
    setLoading(true);
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : '';
      const [listRes, statsRes, readyRes, meRes] = await Promise.all([
        portalFetch(`/v1/processes${q}`, { sessionId: s.sessionId }),
        portalFetch('/v1/processes/stats', { sessionId: s.sessionId }),
        portalFetch('/v1/health/ready'),
        portalFetch('/v1/auth/me', { sessionId: s.sessionId }),
      ]);
      const list = await listRes.json();
      if (!listRes.ok) throw new Error(list.message ?? listRes.statusText);
      setRows(list.processes ?? []);

      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (readyRes.ok) {
        const ready = await readyRes.json();
        setCoreOk(Boolean(ready.core?.reachable));
      } else {
        setCoreOk(null);
      }
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.displayName) setDisplayName(me.displayName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [router, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="card reveal">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p className="muted" style={{ margin: 0 }}>
              {t('dash.welcome')}
            </p>
            <h1 style={{ marginBottom: 0.2 }}>{displayName || institutionId}</h1>
            <p className="lead" style={{ marginBottom: 0 }}>
              {t('dash.lead')} · <code>{institutionId}</code>
            </p>
          </div>
          <div className="actions">
            <Link href="/tokenization">
              <button type="button" className="primary">
                {t('dash.new')}
              </button>
            </Link>
            <button type="button" className="secondary" onClick={() => void load()}>
              {t('nc.refresh')}
            </button>
          </div>
        </div>
      </div>

      {coreOk === false && (
        <div className="banner warn">
          Core Orchestrator is unreachable from the edge. You can still prepare packages; hand-off
          will stay <code>awaiting_core</code> until Core is back (no mint on portal).
        </div>
      )}
      {coreOk === true && (
        <div className="banner ok">Core hand-off path is reachable.</div>
      )}

      <div className="kpis">
        <div className="kpi">
          <div className="label">Total processes</div>
          <div className="value">{stats?.total ?? rows.length}</div>
          <div className="hint">Edge-tracked for this institution</div>
        </div>
        <div className="kpi">
          <div className="label">At Core</div>
          <div className="value">{stats?.submittedToCore ?? '—'}</div>
          <div className="hint">submitted_to_core</div>
        </div>
        <div className="kpi">
          <div className="label">Awaiting Core</div>
          <div className="value">{stats?.awaitingCore ?? '—'}</div>
          <div className="hint">queued or Core down</div>
        </div>
        <div className="kpi">
          <div className="label">Last submit</div>
          <div className="value" style={{ fontSize: '0.95rem', fontWeight: 600 }}>
            {stats?.lastSubmittedAt
              ? new Date(stats.lastSubmittedAt).toLocaleString()
              : '—'}
          </div>
          <div className="hint">Newest process on edge</div>
        </div>
      </div>

      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h2 style={{ margin: 0 }}>Processes</h2>
          <div style={{ minWidth: 200 }}>
            <label htmlFor="filter" style={{ marginBottom: 0.2 }}>
              Filter by status
            </label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: 0 }}
            >
              <option value="">All</option>
              <option value="awaiting_core">awaiting_core</option>
              <option value="submitted_to_core">submitted_to_core</option>
              <option value="documents_pending">documents_pending</option>
              <option value="rejected">rejected</option>
            </select>
          </div>
        </div>

        {error && <p className="err">{error}</p>}
        {loading && <p className="muted">Loading…</p>}

        {!loading && rows.length === 0 ? (
          <div className="empty">
            <strong>No processes yet</strong>
            Start a primary tokenization package for this institution.
            <div className="actions" style={{ justifyContent: 'center', marginTop: '1rem' }}>
              <Link href="/tokenization">
                <button type="button" className="primary">
                  Create first process
                </button>
              </Link>
            </div>
          </div>
        ) : (
          !loading && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Valuation</th>
                    <th>Holder</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.processId}>
                      <td>
                        <Link href={`/tokenization/${encodeURIComponent(r.processId)}`}>
                          <code>{r.processId}</code>
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="muted">{r.processType?.replace(/_/g, ' ')}</td>
                      <td className="mono">{r.valuation}</td>
                      <td>{r.holderId}</td>
                      <td className="muted">{new Date(r.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </>
  );
}
