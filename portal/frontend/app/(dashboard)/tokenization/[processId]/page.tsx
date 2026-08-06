'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { loadSession, portalFetch } from '../../../../lib/auth';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  PIPELINE_STEPS,
  statusLabel,
  type ProgressPayload,
  type ProgressStep,
} from '../../../../lib/status';
import { buildVerifyUrl, certificatePrintHtml } from '../../../../lib/certificate-print';
import { useI18n } from '../../../../lib/i18n/context';

const POLL_MS = 3000;
const POLL_MAX = 60;

function ProcessStatusPageInner() {
  const params = useParams();
  const search = useSearchParams();
  const processId = decodeURIComponent(String(params.processId ?? ''));
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [cert, setCert] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [secondsToNext, setSecondsToNext] = useState(Math.floor(POLL_MS / 1000));
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [walletInput, setWalletInput] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const wantCert = search.get('certificate') === '1';

  const verifyUrl = useMemo(
    () =>
      buildVerifyUrl(
        processId,
        cert?.qrVerifyPath != null ? String(cert.qrVerifyPath) : cert?.publicLookupPath != null
          ? String(cert.publicLookupPath)
          : undefined,
      ),
    [processId, cert],
  );

  /** Wallet-scannable payload: prefer compact AST URI + verify; wallets open https/ethereum URIs */
  const qrPayload = useMemo(() => {
    const wc = cert?.walletCompat as
      | { astUri?: string; eip681?: string | null; holderWallet?: string | null }
      | undefined;
    // Prefer https verify URL (works in every wallet camera + browser).
    // Append wallet + process for dApps that parse query params.
    try {
      const u = new URL(verifyUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      u.searchParams.set('ast', 'certificate-v1');
      if (wc?.holderWallet) u.searchParams.set('wallet', String(wc.holderWallet));
      if (cert?.documentPackageHash) u.searchParams.set('hash', String(cert.documentPackageHash).slice(0, 16));
      return u.toString();
    } catch {
      return verifyUrl;
    }
  }, [verifyUrl, cert]);

  useEffect(() => {
    if (!processId) return;
    let cancelled = false;
    void QRCode.toDataURL(qrPayload, {
      width: 256,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [processId, qrPayload]);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      const s = loadSession();
      if (!s) {
        router.replace('/login');
        return;
      }
      if (!processId) return;
      if (quiet) setRefreshing(true);
      else setInitialLoading(true);
      setError(null);
      try {
        const res = await portalFetch(`/v1/processes/${encodeURIComponent(processId)}`, {
          sessionId: s.sessionId,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message ?? res.statusText);
        setData(body);

        const cRes = await portalFetch(
          `/v1/processes/${encodeURIComponent(processId)}/certificate`,
          { sessionId: s.sessionId },
        );
        if (cRes.ok) {
          setCert(await cRes.json());
        }
        setLastRefreshAt(new Date().toISOString());
        setPollTick((t) => t + 1);
        setSecondsToNext(Math.floor(POLL_MS / 1000));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setInitialLoading(false);
        setRefreshing(false);
      }
    },
    [processId, router],
  );

  useEffect(() => {
    void load({ quiet: false });
  }, [load]);

  const progress = (data?.progress as ProgressPayload | undefined) ?? null;
  const status = String(data?.status ?? data?.stage ?? '');
  const source = String(data?.source ?? 'edge');
  const potDone =
    progress?.potDone === true ||
    data?.potVerified === 1 ||
    data?.verified === 1 ||
    (data?.verdict as { verified?: number } | undefined)?.verified === 1;
  const mintAmountLive =
    data?.mintAmount ??
    (data?.mint as { amount?: string } | undefined)?.amount ??
    cert?.mintAmountAro ??
    null;
  const mintDone =
    progress?.mintDone === true ||
    mintAmountLive != null ||
    status === 'settled' ||
    status === 'completed';
  const submitted =
    progress?.handedOff === true ||
    status === 'submitted_to_core' ||
    source === 'core' ||
    potDone ||
    mintDone;
  const finished = mintDone && potDone;

  // Quiet auto-refresh until finished
  useEffect(() => {
    if (!processId || finished) return;
    const t = setInterval(() => {
      void load({ quiet: true });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [processId, finished, load]);

  // Countdown UI between polls
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => {
      setSecondsToNext((s) => (s <= 1 ? Math.floor(POLL_MS / 1000) : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [finished, pollTick]);

  const steps: ProgressStep[] = useMemo(() => {
    if (progress?.steps?.length) return progress.steps;
    return PIPELINE_STEPS.map((s) => {
      let state: ProgressStep['state'] = 'pending';
      if (s.id === 'admitted') state = 'done';
      else if (s.id === 'core') state = submitted ? 'done' : status === 'awaiting_core' ? 'active' : 'pending';
      else if (s.id === 'pot') state = potDone ? 'done' : submitted ? 'active' : 'pending';
      else if (s.id === 'mint') state = mintDone ? 'done' : potDone ? 'active' : 'pending';
      return { id: s.id, title: s.title, state, detail: s.desc };
    });
  }, [progress, submitted, status, potDone, mintDone]);

  const percent =
    progress?.percent ??
    Math.round((steps.filter((s) => s.state === 'done').length / steps.length) * 100);

  const liveMessage =
    progress?.message ??
    (mintDone
      ? 'Process complete on Core path'
      : submitted
        ? 'Handed off — waiting for PoT / mint on Core'
        : 'Waiting for Core hand-off');

  async function retryHandoff() {
    const s = loadSession();
    if (!s) return;
    setRetryBusy(true);
    setError(null);
    try {
      const res = await portalFetch(
        `/v1/processes/${encodeURIComponent(processId)}/retry-handoff`,
        { method: 'POST', sessionId: s.sessionId },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      await load({ quiet: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetryBusy(false);
    }
  }

  function downloadCertificateJson() {
    if (!cert) return;
    const payload = {
      ...cert,
      verifyUrl,
      qrPayload,
      qrIncluded: true,
      walletCompatible: true,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AST-digitization-${processId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadWalletMetadata() {
    const wc = cert?.walletCompat as { erc721Metadata?: Record<string, unknown> } | undefined;
    const meta = wc?.erc721Metadata;
    if (!meta) return;
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AST-wallet-metadata-${processId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function printCertificate() {
    if (!cert) return;
    let qr = qrDataUrl;
    if (!qr) {
      qr = await QRCode.toDataURL(qrPayload, {
        width: 256,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(qr);
    }
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      certificatePrintHtml({
        cert,
        processId,
        qrDataUrl: qr,
        verifyUrl: qrPayload,
        potDone,
        mintAmount: mintAmountLive != null ? String(mintAmountLive) : null,
        submitted,
      }),
    );
    w.document.close();
  }

  function isValidEvm(addr: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
  }

  async function bindWallet(address: string) {
    const s = loadSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    const wallet = address.trim();
    if (!isValidEvm(wallet)) {
      setWalletMsg(t('cert.walletInvalid'));
      return;
    }
    setWalletBusy(true);
    setWalletMsg(null);
    setError(null);
    try {
      const res = await portalFetch(
        `/v1/processes/${encodeURIComponent(processId)}/bind-wallet`,
        {
          method: 'POST',
          sessionId: s.sessionId,
          body: JSON.stringify({ holderWallet: wallet }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? res.statusText);
      setWalletInput(wallet);
      setWalletMsg(t('cert.walletBound'));
      await load({ quiet: true });
    } catch (e) {
      setWalletMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setWalletBusy(false);
    }
  }

  async function connectMetaMask() {
    setWalletMsg(null);
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<string[]> } })
      .ethereum;
    if (!eth?.request) {
      setWalletMsg(t('cert.walletNoMm'));
      return;
    }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      const addr = accounts?.[0];
      if (!addr) {
        setWalletMsg(t('cert.walletNoMm'));
        return;
      }
      setWalletInput(addr);
      await bindWallet(addr);
    } catch (e) {
      setWalletMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function openPublicCertificate() {
    const path =
      cert?.publicLookupPath != null
        ? String(cert.publicLookupPath)
        : `/explore?processId=${encodeURIComponent(processId)}`;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function openWalletUri() {
    const wc = cert?.walletCompat as { eip681?: string | null; holderWallet?: string | null } | undefined;
    const uri = wc?.eip681 || (wc?.holderWallet ? `ethereum:${wc.holderWallet}` : null);
    if (!uri) {
      setWalletMsg(t('cert.walletNeedBind'));
      return;
    }
    window.location.href = uri;
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/dashboard">{t('tok.backCabinet')}</Link>
        {' · '}
        <Link href="/tokenization">{t('cert.newProcess')}</Link>
      </p>

      {wantCert && (
        <div className="banner ok" style={{ marginBottom: '1rem' }}>
          {t('cert.banner')}
        </div>
      )}

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
          <p className="eyebrow" style={{ margin: 0 }}>
            {t('cert.eyebrow')}
          </p>
          <h1 style={{ wordBreak: 'break-all', marginTop: '0.25rem' }}>
            <code style={{ fontSize: '0.9em' }}>{processId}</code>
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.88rem' }}>
            {t('cert.codeHint')}
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={refreshing}
            onClick={() => void load({ quiet: true })}
          >
            {refreshing ? t('cert.refreshing') : t('cert.refresh')}
          </button>
        </div>
      </div>

      {initialLoading && !data && <p className="muted">{t('cert.loading')}</p>}
      {error && <p className="err">{error}</p>}

      {data && (
        <>
          {/* Live status strip */}
          <div className="card flat" style={{ marginBottom: '1rem' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem 1rem',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <StatusBadge status={status} />
              <span className={`badge ${source === 'core' || submitted ? 'ok' : 'warn'}`}>
                {source === 'core' || submitted ? t('cert.corePath') : t('cert.edgeOnly')}
              </span>
              {refreshing && <span className="badge info">{t('cert.refreshing')}</span>}
              {!finished && (
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  {t('cert.autoIn')} {secondsToNext}s
                </span>
              )}
              {lastRefreshAt && (
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {t('cert.lastUpdate')} {new Date(lastRefreshAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <p style={{ margin: '0 0 0.5rem', fontWeight: 650 }}>{liveMessage}</p>
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              <strong>{statusLabel(status)}</strong>
              {progress?.currentTitle ? (
                <>
                  {' '}
                  · <strong>{progress.currentTitle}</strong>
                </>
              ) : null}
            </p>

            <div className="progress-track" aria-label={`${t('cert.progress')} ${percent}%`}>
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>
              {t('cert.progress')} <strong>{percent}%</strong>
              {mintAmountLive != null ? (
                <>
                  {' '}
                  · {t('cert.mint')} <strong className="mono">{String(mintAmountLive)}</strong> ARO
                </>
              ) : null}
            </p>
          </div>

          {!submitted && (
            <div className="banner warn">
              <strong>Core hand-off not finished yet.</strong> PoT and mint cannot start until Core
              accepts the process.
              {progress?.coreErrorCode ? (
                <>
                  <br />
                  <span className="mono" style={{ fontSize: '0.85rem' }}>
                    {String(progress.coreErrorCode)}
                    {progress.coreErrorMessage
                      ? `: ${String(progress.coreErrorMessage)}`
                      : ''}
                  </span>
                </>
              ) : null}
              <br />
              <span className="muted" style={{ fontSize: '0.88rem' }}>
                Fix: ensure Core knows login <code>pilot</code> / salt <code>pilot</code>, journal
                is healthy, then Retry. Or run <code>bash scripts/home-up.sh</code> and start a{' '}
                <strong>new</strong> process.
              </span>
              <div className="actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={retryBusy}
                  onClick={() => void retryHandoff()}
                >
                  {retryBusy ? 'Retrying…' : 'Retry / continue on Core'}
                </button>
              </div>
            </div>
          )}

          {submitted && !potDone && (
            <div className="banner warn">
              <strong>On Core, waiting for PoT.</strong> If this stays here, the pipeline was
              interrupted — click <strong>Continue on Core</strong> to finish PoT → mint.
              <div className="actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={retryBusy}
                  onClick={() => void retryHandoff()}
                >
                  {retryBusy ? 'Continuing…' : 'Continue on Core (PoT → mint)'}
                </button>
              </div>
            </div>
          )}

          {potDone && !mintDone && (
            <div className="banner warn">
              <strong>PoT done, mint pending.</strong> Continue to complete economic settle.
              <div className="actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={retryBusy}
                  onClick={() => void retryHandoff()}
                >
                  {retryBusy ? 'Continuing…' : 'Continue mint on Core'}
                </button>
              </div>
            </div>
          )}

          {mintDone && (
            <div className="banner ok">
              <strong>Done.</strong> Mint recorded
              {mintAmountLive != null ? (
                <>
                  : <span className="mono">{String(mintAmountLive)}</span> ARO
                </>
              ) : null}
              . Certificate below reflects this state after refresh.
            </div>
          )}

          <h2>Pipeline</h2>
          <div className="timeline pipeline-live">
            {steps.map((s) => (
              <div key={s.id} className={`item ${s.state}`.trim()}>
                <div className="t">
                  {s.state === 'done' && '✓ '}
                  {s.state === 'active' && '→ '}
                  {s.title}
                  <span className={`step-pill ${s.state}`}>
                    {s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : 'waiting'}
                  </span>
                </div>
                <div className="d">{s.detail ?? ''}</div>
              </div>
            ))}
          </div>

          <div className="actions" style={{ marginTop: '1rem' }}>
            {(!submitted || !mintDone) && (
              <button
                type="button"
                className="primary"
                disabled={retryBusy}
                onClick={() => void retryHandoff()}
              >
                {retryBusy
                  ? 'Working…'
                  : !submitted
                    ? 'Retry Core hand-off'
                    : 'Continue on Core (PoT → mint)'}
              </button>
            )}
            <Link href={`/nodechain?processId=${encodeURIComponent(processId)}`}>
              <button type="button" className="secondary">
                Open NodeChain history
              </button>
            </Link>
          </div>
        </>
      )}

      {cert && (
        <section className="card flat nc-node-detail cert-preview" style={{ marginTop: '1.25rem' }}>
          <div className="nc-node-detail-head">
            <div>
              <p className="eyebrow">{t('cert.certificate')}</p>
              <h2 style={{ margin: '0.2rem 0' }}>
                {String(cert.title ?? 'Digitization certificate')}
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                Open the certificate, verify publicly, and bind an EVM wallet (MetaMask) for
                wallet-compatible export. Binding is representation only — not on-chain mint.
              </p>
            </div>
            {qrDataUrl && (
              <div className="cert-qr-inline">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Certificate verification QR" width={112} height={112} />
                <span className="muted" style={{ fontSize: '0.72rem' }}>
                  Scan to verify
                </span>
              </div>
            )}
          </div>
          <div className="grid2" style={{ marginBottom: '0.75rem' }}>
            <div>
              <div className="muted">Valuation</div>
              <div className="mono" style={{ fontWeight: 700 }}>
                {String(cert.institutionalValuation ?? data?.valuation ?? '—')}
              </div>
            </div>
            <div>
              <div className="muted">Mint (Core)</div>
              <div className="mono" style={{ fontWeight: 700 }}>
                {mintAmountLive != null
                  ? String(mintAmountLive)
                  : cert.mintAmountAro != null
                    ? String(cert.mintAmountAro)
                    : 'pending…'}
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            Serial:{' '}
            <code className="mono">{String(cert.certificateSerial ?? `AST-CERT-${processId}`)}</code>
            <br />
            QR → <code className="mono" style={{ fontSize: '0.75rem' }}>{verifyUrl}</code>
            <br />
            PoT: {potDone ? 'verified' : 'pending'} · Hand-off: {submitted ? 'yes' : 'no'}
            <br />
            {t('cert.walletField')}:{' '}
            <code className="mono">
              {String(
                cert.holderWallet ??
                  (cert.walletCompat as { holderWallet?: string } | undefined)?.holderWallet ??
                  t('cert.walletNotBound'),
              )}
            </code>
          </p>

          {/* Open certificate */}
          <div className="actions" style={{ marginBottom: '0.85rem' }}>
            <button type="button" className="primary" onClick={() => void printCertificate()}>
              {t('cert.openPrint')}
            </button>
            <button type="button" className="secondary" onClick={openPublicCertificate}>
              {t('cert.openPublic')}
            </button>
            <button type="button" className="secondary" onClick={downloadCertificateJson}>
              {t('cert.downloadJson')}
            </button>
            {(cert.walletCompat as { erc721Metadata?: unknown } | undefined)?.erc721Metadata ? (
              <button type="button" className="secondary" onClick={downloadWalletMetadata}>
                {t('cert.walletMeta')}
              </button>
            ) : null}
          </div>

          {/* Bind crypto wallet */}
          <div
            className="card flat"
            style={{ marginTop: '0.5rem', marginBottom: 0, background: 'var(--bg2)' }}
          >
            <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>{t('cert.walletTitle')}</h3>
            <p className="muted" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
              {t('cert.walletLead')}
            </p>
            <label htmlFor="bind-wallet">{t('cert.walletLabel')}</label>
            <input
              id="bind-wallet"
              className="mono"
              value={
                walletInput ||
                String(
                  cert.holderWallet ??
                    (cert.walletCompat as { holderWallet?: string } | undefined)?.holderWallet ??
                    '',
                )
              }
              onChange={(e) => setWalletInput(e.target.value)}
              placeholder={t('cert.walletPlaceholder')}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={walletBusy}
                onClick={() => void connectMetaMask()}
              >
                {walletBusy ? '…' : t('cert.walletConnect')}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={walletBusy}
                onClick={() =>
                  void bindWallet(
                    walletInput ||
                      String(
                        cert.holderWallet ??
                          (cert.walletCompat as { holderWallet?: string } | undefined)
                            ?.holderWallet ??
                          '',
                      ),
                  )
                }
              >
                {walletBusy ? '…' : t('cert.walletBind')}
              </button>
              <button type="button" className="ghost" onClick={openWalletUri}>
                {t('cert.walletOpenUri')}
              </button>
            </div>
            {walletMsg ? (
              <p className="muted" style={{ margin: '0.65rem 0 0', fontSize: '0.85rem' }}>
                {walletMsg}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {data && (
        <details style={{ marginTop: '1rem' }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            Technical status (JSON)
          </summary>
          <pre className="result">{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export default function ProcessStatusPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">Loading process…</p></div>}>
      <ProcessStatusPageInner />
    </Suspense>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
