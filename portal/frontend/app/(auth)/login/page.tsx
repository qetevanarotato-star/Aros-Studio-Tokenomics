'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiBase, loadSession, saveSession } from '../../../lib/auth';
import { useI18n } from '../../../lib/i18n/context';

type StackHealth = {
  edge: 'up' | 'down' | 'checking';
  core: 'up' | 'down' | 'unknown' | 'checking';
  detail?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [login, setLogin] = useState('');
  const [salt, setSalt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [institutions, setInstitutions] = useState<
    Array<{ institutionId: string; displayName: string; role?: string }>
  >([]);
  const [stack, setStack] = useState<StackHealth>({
    edge: 'checking',
    core: 'checking',
  });

  useEffect(() => {
    if (loadSession()) {
      router.replace('/dashboard');
      return;
    }
    void probeStack();
    void fetch(`${apiBase()}/v1/auth/institutions`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d.institutions ?? []) as Array<{
          institutionId: string;
          displayName: string;
          role?: string;
        }>;
        setInstitutions(list);
        // Prefer first non-operator institution as login id (salt still from credentials file)
        const preferred =
          list.find((i) => (i.role ?? 'institution') !== 'operator') ?? list[0];
        if (preferred && !login) {
          setLogin(preferred.institutionId);
        }
      })
      .catch(() => setInstitutions([]));
  }, [router]);

  async function probeStack() {
    setStack({ edge: 'checking', core: 'checking' });
    try {
      const healthRes = await fetch(`${apiBase()}/v1/health`, { cache: 'no-store' });
      if (!healthRes.ok) {
        setStack({
          edge: 'down',
          core: 'unknown',
          detail: `Edge HTTP ${healthRes.status}`,
        });
        return;
      }
      const readyRes = await fetch(`${apiBase()}/v1/health/ready`, { cache: 'no-store' });
      if (!readyRes.ok) {
        setStack({
          edge: 'up',
          core: 'unknown',
          detail: 'Ready probe failed',
        });
        return;
      }
      const ready = await readyRes.json();
      const coreUp = Boolean(ready.core?.reachable);
      setStack({
        edge: 'up',
        core: coreUp ? 'up' : 'down',
        detail: coreUp
          ? undefined
          : String(ready.core?.reason ?? 'Core unreachable from edge'),
      });
    } catch {
      setStack({
        edge: 'down',
        core: 'unknown',
        detail: 'Cannot reach portal edge. Run: bash scripts/home-up.sh',
      });
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // API still uses institutionId + token; UI labels are Login + Salt
      const res = await fetch(`${apiBase()}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          institutionId: login.trim(),
          token: salt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? res.statusText);
      }
      saveSession({
        sessionId: data.sessionId,
        institutionId: data.institutionId,
        displayName: data.displayName,
        expiresAt: data.expiresAt,
        role: data.role ?? 'institution',
      });
      if (data.role === 'operator') {
        router.push('/ops');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void probeStack();
    } finally {
      setBusy(false);
    }
  }

  const edgeOk = stack.edge === 'up';
  const coreOk = stack.core === 'up';

  const stackLabel = (s: string) => {
    if (s === 'up') return t('login.stack.up');
    if (s === 'down') return t('login.stack.down');
    if (s === 'checking') return t('login.stack.checking');
    return t('login.stack.unknown');
  };

  return (
    <div className="card" style={{ maxWidth: 480, margin: '1.5rem auto' }}>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('login.stack.edge')}: {stackLabel(stack.edge)} · {t('login.stack.core')}:{' '}
        {stackLabel(stack.core)}
      </p>
      <h1>{t('login.title')}</h1>
      <p className="lead">{t('login.lead')}</p>

      {stack.edge === 'checking' && (
        <div className="banner warn">{t('common.loading')}</div>
      )}
      {stack.edge === 'down' && (
        <div className="banner warn">
          <strong>{t('login.stack.edge')}: {t('login.stack.down')}</strong>
          <br />
          <code className="mono">bash scripts/home-up.sh</code>
          {stack.detail ? (
            <>
              <br />
              <span className="muted">{stack.detail}</span>
            </>
          ) : null}
          <div className="actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="secondary" onClick={() => void probeStack()}>
              Retry
            </button>
          </div>
        </div>
      )}
      {edgeOk && !coreOk && stack.core !== 'checking' && (
        <div className="banner warn">
          <strong>
            {t('login.stack.edge')}: {t('login.stack.up')} · {t('login.stack.core')}:{' '}
            {t('login.stack.down')}
          </strong>
          <div className="actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="secondary" onClick={() => void probeStack()}>
              Retry
            </button>
          </div>
        </div>
      )}
      {edgeOk && coreOk && (
        <div className="banner ok">
          {t('login.stack.edge')}+{t('login.stack.core')}: {t('login.stack.up')}
          <button
            type="button"
            className="linkish"
            style={{ marginLeft: '0.75rem' }}
            onClick={() => void probeStack()}
          >
            recheck
          </button>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <label htmlFor="login">{t('login.login')}</label>
        {institutions.length > 0 ? (
          <select
            id="login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          >
            <option value="" disabled>
              {t('login.login')}…
            </option>
            {institutions.map((i) => (
              <option key={i.institutionId} value={i.institutionId.toLowerCase()}>
                {i.displayName} ({i.institutionId.toLowerCase()})
              </option>
            ))}
          </select>
        ) : (
          <input
            id="login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            autoComplete="username"
            placeholder="pilot"
          />
        )}

        <label htmlFor="salt">{t('login.salt')}</label>
        <input
          id="salt"
          type="text"
          value={salt}
          onChange={(e) => setSalt(e.target.value)}
          required
          autoComplete="off"
          placeholder="bog"
          spellCheck={false}
        />

        <button
          className="primary"
          type="submit"
          disabled={busy || stack.edge === 'down'}
          style={{ width: '100%' }}
        >
          {busy ? t('login.busy') : t('login.submit')}
        </button>
        {error && <p className="err">{error}</p>}
      </form>

      <div className="callout" style={{ marginBottom: 0, marginTop: '1.1rem' }}>
        <strong>Простой вход</strong>
        <br />
        Login <code>BOG</code> · salt <code>bog</code>
        <br />
        Login <code>MERCURY</code> · salt <code>mercury</code>
        <br />
        Login <code>OPS</code> · salt <code>ops</code> (панель)
      </div>
    </div>
  );
}
