'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadSession, portalFetch } from '../../../lib/auth';
import {
  VALUATION_CURRENCIES,
  computeAroMintAmount,
  type ValuationCurrencyCode,
} from '../../../lib/currencies';
import {
  FALLBACK_CATALOG,
  flattenSlotFiles,
  requiredSlotsOk,
  type AssetTypeDef,
  type AssetTypeSummary,
  type EvidenceSlot,
} from '../../../lib/asset-evidence';
import { useI18n } from '../../../lib/i18n/context';

function randomIdem(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sha256File(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = String(reader.result ?? '');
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

type SigVerify = {
  ok: boolean;
  verified: boolean;
  verificationId: string;
  documentPackageHash: string;
  verifiedAt: string;
  message?: string;
  signerId?: string;
  mode?: string;
  signer?: {
    subject?: string;
    fingerprint256?: string;
  };
  chainDepth?: number;
};

/**
 * Document-first institutional path:
 * 0) Choose asset type → typed evidence slots
 * 1) Upload evidence package (per slot)
 * 2) Confirm electronic signature
 * 3) Declare fields AS STATED IN the verified package
 * 4) Optional enrichment (bureau signals)
 * 5) Start tokenization → certificate
 */
export default function TokenizationWizardPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  const [assetTypeOptions, setAssetTypeOptions] = useState<AssetTypeSummary[]>(
    FALLBACK_CATALOG.map(({ id, label, description }) => ({ id, label, description })),
  );
  const [evidenceDef, setEvidenceDef] = useState<AssetTypeDef | null>(
    FALLBACK_CATALOG.find((t) => t.id === 'real_estate') ?? null,
  );
  /** slotId → files for that evidentiary document */
  const [slotFiles, setSlotFiles] = useState<Record<string, File[]>>({});

  /** Multi-file package flattened from slots */
  const [files, setFiles] = useState<File[]>([]);
  const [documentPackageHash, setDocumentPackageHash] = useState('');
  const [fileMeta, setFileMeta] = useState<string | null>(null);
  const [hashBusy, setHashBusy] = useState(false);

  const [hasQualifiedSignature, setHasQualifiedSignature] = useState(false);
  const [signatureAttestation, setSignatureAttestation] = useState('');
  const [signerId, setSignerId] = useState('');
  /** institutional_attestation (v1) | x509_detached (D4) */
  const [sigMode, setSigMode] = useState<'institutional_attestation' | 'x509_detached'>(
    'institutional_attestation',
  );
  const [signerCertificatePem, setSignerCertificatePem] = useState('');
  const [signatureBase64, setSignatureBase64] = useState('');
  const [certificateChainPem, setCertificateChainPem] = useState('');
  const [sigVerify, setSigVerify] = useState<SigVerify | null>(null);
  const [sigBusy, setSigBusy] = useState(false);

  const [assetType, setAssetType] = useState('real_estate');
  /** Amount as printed on the document (any institutional currency). */
  const [amountFromDocument, setAmountFromDocument] = useState('');
  const [valuationCurrency, setValuationCurrency] =
    useState<ValuationCurrencyCode>('USD');
  const [holderId, setHolderId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [holderWallet, setHolderWallet] = useState('');
  const [note, setNote] = useState('');
  const [fieldsFromDocument, setFieldsFromDocument] = useState(false);
  const [enrichment, setEnrichment] = useState<{
    enrichmentId: string;
    provider: string;
    signals: {
      identityMatch: string;
      assetPresence: string;
      valueContext: string;
      notes: string[];
    };
    disclaimer: string;
  } | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichmentConfirmed, setEnrichmentConfirmed] = useState(false);

  /**
   * v1: fixed institutional 1:1 mapping of the document figure into ARO units.
   * No rate field for the initiator — they only restate what is on the paper (amount + currency).
   * AST does not invent FX; Core mints the same number as ARO after PoT.
   */
  const aroMintAmount = useMemo(
    () => computeAroMintAmount(amountFromDocument, '1'),
    [amountFromDocument],
  );

  const [idempotencyKey, setIdempotencyKey] = useState(randomIdem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractHints, setExtractHints] = useState<{
    suggestedValuation: string | null;
    suggestedHolderId: string | null;
    suggestedAssetId: string | null;
    amountsFound: string[];
    textPreview: string;
    notes: string[];
    mode: string;
  } | null>(null);

  useEffect(() => {
    if (!loadSession()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    const s = loadSession();
    if (!s) return;
    void (async () => {
      try {
        const res = await portalFetch('/v1/catalog/asset-types', {
          method: 'GET',
          sessionId: s.sessionId,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { assetTypes?: AssetTypeSummary[] };
        if (body.assetTypes?.length) setAssetTypeOptions(body.assetTypes);
      } catch {
        /* keep fallback */
      }
    })();
  }, []);

  async function loadEvidenceForType(typeId: string) {
    const s = loadSession();
    const fallback = FALLBACK_CATALOG.find((t) => t.id === typeId) ?? null;
    if (!s) {
      setEvidenceDef(fallback);
      return;
    }
    try {
      const res = await portalFetch(
        `/v1/catalog/evidence-requirements?assetType=${encodeURIComponent(typeId)}`,
        { method: 'GET', sessionId: s.sessionId },
      );
      if (!res.ok) {
        setEvidenceDef(fallback);
        return;
      }
      const body = (await res.json()) as {
        assetType: string;
        label: string;
        description: string;
        slots: EvidenceSlot[];
      };
      setEvidenceDef({
        id: body.assetType,
        label: body.label,
        description: body.description,
        slots: body.slots,
      });
    } catch {
      setEvidenceDef(fallback);
    }
  }

  const slots: EvidenceSlot[] = evidenceDef?.slots ?? [];
  const step0Ok = Boolean(assetType && evidenceDef);
  const step1Ok =
    documentPackageHash.length === 64 &&
    files.length > 0 &&
    requiredSlotsOk(slots, slotFiles);
  const step2Ok = !!sigVerify?.verified && hasQualifiedSignature;
  const step3Ok =
    fieldsFromDocument &&
    amountFromDocument.trim().length > 0 &&
    holderId.trim().length > 0 &&
    !!aroMintAmount &&
    /^-?\d+(\.\d{1,18})?$/.test(amountFromDocument.trim().replace(/,/g, ''));
  const step4Ok = enrichmentConfirmed || enrichment != null;

  const canSubmit = useMemo(
    () =>
      step0Ok &&
      step1Ok &&
      step2Ok &&
      step3Ok &&
      step4Ok &&
      idempotencyKey.trim().length >= 8,
    [step0Ok, step1Ok, step2Ok, step3Ok, step4Ok, idempotencyKey],
  );

  async function rehashPackage(nextFiles: File[]) {
    setError(null);
    setSigVerify(null);
    setFieldsFromDocument(false);
    setFiles(nextFiles);
    setDocumentPackageHash('');
    setFileMeta(null);
    setExtractHints(null);
    if (nextFiles.length === 0) return;
    setHashBusy(true);
    try {
      // Stable package fingerprint: ordered name + content hashes joined
      const digests: string[] = [];
      for (const f of nextFiles) {
        digests.push(`${f.name}:${await sha256File(f)}`);
      }
      digests.sort();
      const material = digests.join('\n');
      const hex = await crypto.subtle
        .digest('SHA-256', new TextEncoder().encode(material))
        .then((buf) =>
          [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''),
        );
      setDocumentPackageHash(hex);
      setFileMeta(
        `${nextFiles.length} file(s) · ${nextFiles.map((f) => f.name).join(', ')} · package fingerprint ready`,
      );
      const s = loadSession();
      if (s) {
        const parts = await Promise.all(
          nextFiles.map(async (f) => ({
            name: f.name,
            content: await fileToBase64(f),
            encoding: 'base64' as const,
          })),
        );
        await portalFetch('/v1/documents/hash', {
          method: 'POST',
          sessionId: s.sessionId,
          body: JSON.stringify({ parts }),
        }).catch(() => null);
        // Assist: try text signals from first PDF / file
        const primary = nextFiles.find((f) => f.name.toLowerCase().endsWith('.pdf')) ?? nextFiles[0];
        if (primary) {
          const b64 = await fileToBase64(primary);
          const ex = await portalFetch('/v1/documents/extract', {
            method: 'POST',
            sessionId: s.sessionId,
            body: JSON.stringify({
              fileName: primary.name,
              contentBase64: b64,
            }),
          });
          if (ex.ok) {
            const body = await ex.json();
            setExtractHints({
              suggestedValuation: body.suggestedValuation ?? null,
              suggestedHolderId: body.suggestedHolderId ?? null,
              suggestedAssetId: body.suggestedAssetId ?? null,
              amountsFound: body.amountsFound ?? [],
              textPreview: body.textPreview ?? '',
              notes: body.notes ?? [],
              mode: body.mode ?? 'empty',
            });
          } else {
            setExtractHints(null);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHashBusy(false);
    }
  }

  async function onSlotFilesSelected(slotId: string, list: FileList | null) {
    const next = { ...slotFiles };
    if (!list?.length) {
      delete next[slotId];
    } else {
      next[slotId] = [...list];
    }
    setSlotFiles(next);
    setEnrichment(null);
    setEnrichmentConfirmed(false);
    await rehashPackage(flattenSlotFiles(next));
  }

  async function runEnrichment() {
    setError(null);
    setEnrichBusy(true);
    try {
      const s = loadSession();
      if (!s) {
        router.replace('/login');
        return;
      }
      const res = await portalFetch('/v1/enrichment/check', {
        method: 'POST',
        sessionId: s.sessionId,
        body: JSON.stringify({
          assetType,
          holderId: holderId.trim() || undefined,
          assetId: assetId.trim() || undefined,
          documentPackageHash,
          amountFromDocument: amountFromDocument.trim().replace(/,/g, ''),
          currency: valuationCurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? res.statusText);
      setEnrichment({
        enrichmentId: data.enrichmentId,
        provider: data.provider,
        signals: data.signals,
        disclaimer: data.disclaimer,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnrichBusy(false);
    }
  }

  async function confirmSignature() {
    setError(null);
    setSigBusy(true);
    setSigVerify(null);
    try {
      const s = loadSession();
      if (!s) {
        router.replace('/login');
        return;
      }
      if (!hasQualifiedSignature) {
        throw new Error('Confirm that a qualified electronic signature is on the document');
      }
      const body =
        sigMode === 'x509_detached'
          ? {
              mode: 'x509_detached',
              documentPackageHash,
              fileName: files.map((f) => f.name).join(', '),
              hasQualifiedSignature: true,
              signerCertificatePem: signerCertificatePem.trim(),
              signatureBase64: signatureBase64.trim(),
              certificateChainPem: certificateChainPem.trim() || undefined,
              signerId: signerId.trim() || undefined,
            }
          : {
              mode: 'institutional_attestation',
              documentPackageHash,
              fileName: files.map((f) => f.name).join(', '),
              hasQualifiedSignature: true,
              signatureAttestation: signatureAttestation.trim(),
              signerId: signerId.trim() || undefined,
            };
      const res = await portalFetch('/v1/documents/verify-signature', {
        method: 'POST',
        sessionId: s.sessionId,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? res.statusText);
      setSigVerify(data as SigVerify);
      setStep(3); // fields from document
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = loadSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await portalFetch('/v1/tokenization/start', {
        method: 'POST',
        sessionId: s.sessionId,
        idempotencyKey: idempotencyKey.trim(),
        body: JSON.stringify({
          assetType,
          institutionalValuation: aroMintAmount,
          amountFromDocument: amountFromDocument.trim().replace(/,/g, ''),
          valuationCurrency,
          institutionalAroPerUnit: '1',
          currency: valuationCurrency,
          holderId: holderId.trim(),
          assetId: assetId.trim() || undefined,
          holderWallet: holderWallet.trim() || undefined,
          hasQualifiedSignature: true,
          documentPackageHash: documentPackageHash.toLowerCase(),
          note: [
            note.trim(),
            files.length ? `files=${files.map((f) => f.name).join('+')}` : '',
            sigVerify ? `sigVerify=${sigVerify.verificationId}` : '',
            holderWallet.trim() ? `wallet=${holderWallet.trim()}` : '',
            `doc=${amountFromDocument.trim()} ${valuationCurrency}`,
            `aroMint=${aroMintAmount}`,
            'source=document_first_package',
          ]
            .filter(Boolean)
            .join(' | ')
            .slice(0, 512),
          metadata: {
            flow: 'document_first_typed_evidence',
            assetType,
            fieldsDeclaredFromDocument: true,
            signatureVerificationId: sigVerify?.verificationId,
            fileNames: files.map((f) => f.name),
            fileCount: files.length,
            evidenceSlots: Object.fromEntries(
              Object.entries(slotFiles).map(([k, v]) => [k, v.map((f) => f.name)]),
            ),
            enrichmentId: enrichment?.enrichmentId,
            enrichmentProvider: enrichment?.provider,
            enrichmentSignals: enrichment?.signals,
            signerId: signerId.trim() || undefined,
            holderWallet: holderWallet.trim() || undefined,
            walletCompat: true,
            valuationCurrency,
            amountFromDocument: amountFromDocument.trim().replace(/,/g, ''),
            institutionalAroPerUnit: '1',
            aroMintAmount,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(`${data.code ?? res.status}: ${data.message ?? res.statusText}`);
      }
      if (data.processId) {
        // Unique process code is processId (AST-PILOT-YYYYMMDD-…)
        try {
          sessionStorage.setItem(
            'ast.lastProcessCode',
            String(data.processId),
          );
        } catch {
          /* ignore */
        }
        router.push(`/tokenization/${encodeURIComponent(data.processId)}?certificate=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        <Link href="/dashboard">{t('tok.backCabinet')}</Link>
      </p>
      <p className="eyebrow">{t('tok.eyebrow')}</p>
      <h1>{t('tok.h1')}</h1>
      <p className="lead">{t('tok.lead')}</p>

      <ul className="steps">
        <li className={step === 0 ? 'active' : step > 0 ? 'done' : ''}>
          <span className="n">0</span> {t('tok.step.asset')}
        </li>
        <li className={step === 1 ? 'active' : step > 1 ? 'done' : ''}>
          <span className="n">1</span> {t('tok.step.evidence')}
        </li>
        <li className={step === 2 ? 'active' : step > 2 ? 'done' : ''}>
          <span className="n">2</span> {t('tok.step.sign')}
        </li>
        <li className={step === 3 ? 'active' : step > 3 ? 'done' : ''}>
          <span className="n">3</span> {t('tok.step.fields')}
        </li>
        <li className={step === 4 ? 'active' : step > 4 ? 'done' : ''}>
          <span className="n">4</span> {t('tok.step.enrich')}
        </li>
        <li className={step === 5 ? 'active' : step > 5 ? 'done' : ''}>
          <span className="n">5</span> {t('tok.step.start')}
        </li>
      </ul>

      <form onSubmit={onSubmit}>
        {/* ——— 0. ASSET TYPE ——— */}
        {step === 0 && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('tok.s0.h')}</h2>
            <p className="muted">{t('tok.s0.p')}</p>
            <label htmlFor="assetType0">{t('tok.step.asset')}</label>
            <select
              id="assetType0"
              value={assetType}
              onChange={(e) => {
                const v = e.target.value;
                setAssetType(v);
                setSlotFiles({});
                setFiles([]);
                setDocumentPackageHash('');
                setFileMeta(null);
                setEnrichment(null);
                setEnrichmentConfirmed(false);
                void loadEvidenceForType(v);
              }}
            >
              {assetTypeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {evidenceDef && (
              <div className="card flat" style={{ marginTop: '1rem' }}>
                <p style={{ marginTop: 0 }}>
                  <strong>{evidenceDef.label}</strong>
                </p>
                <p className="muted">{evidenceDef.description}</p>
                <p style={{ marginBottom: 0 }}>
                  <strong>{t('tok.s0.need')}</strong>
                </p>
                <ul>
                  {evidenceDef.slots.map((s) => (
                    <li key={s.id}>
                      {s.label}{' '}
                      <span className="muted">
                        ({s.required ? t('common.required') : t('common.optional')}) — {s.purpose}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={!step0Ok}
                onClick={() => {
                  void loadEvidenceForType(assetType);
                  setStep(1);
                }}
              >
                {t('tok.s0.next')}
              </button>
            </div>
          </>
        )}

        {/* ——— 1. TYPED EVIDENCE ——— */}
        {step === 1 && (
          <>
            <h2 style={{ marginTop: 0 }}>
              {t('tok.s1.h')}
              {evidenceDef?.label ? ` · ${evidenceDef.label}` : ''}
            </h2>
            <p className="muted">{t('tok.s1.p')}</p>
            {slots.map((s) => (
              <div key={s.id} className="card flat" style={{ marginBottom: '0.75rem' }}>
                <label htmlFor={`slot-${s.id}`}>
                  {s.label}{' '}
                  <span className="muted">
                    ({s.required ? t('common.required') : t('common.optional')})
                  </span>
                </label>
                <p className="muted" style={{ margin: '0.25rem 0 0.5rem', fontSize: '0.85rem' }}>
                  {s.purpose}
                </p>
                <input
                  id={`slot-${s.id}`}
                  type="file"
                  multiple
                  accept={s.acceptHint}
                  onChange={(e) => void onSlotFilesSelected(s.id, e.target.files)}
                />
                {(slotFiles[s.id]?.length ?? 0) > 0 && (
                  <ul className="plain-list" style={{ marginTop: '0.35rem' }}>
                    {slotFiles[s.id]!.map((f) => (
                      <li key={f.name + f.size}>
                        {f.name}{' '}
                        <span className="muted">({(f.size / 1024).toFixed(1)} KB)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {hashBusy && <p className="muted">{t('tok.s1.hashing')}</p>}
            {fileMeta && <p className="ok">{fileMeta}</p>}
            {documentPackageHash && (
              <>
                <label>{t('tok.s1.fingerprint')}</label>
                <input className="mono" readOnly value={documentPackageHash} />
              </>
            )}
            <div className="callout">{t('tok.s1.callout')}</div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setStep(0)}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!step1Ok}
                onClick={() => setStep(2)}
              >
                {t('tok.s1.next')}
              </button>
            </div>
          </>
        )}

        {/* ——— 2. SIGNATURE ——— */}
        {step === 2 && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('tok.s2.h')}</h2>
            <p className="muted">{t('tok.s2.p')}</p>
            <div className="card flat" style={{ marginBottom: '1rem' }}>
              <p style={{ margin: 0 }}>
                <strong>{t('tok.s2.package')}</strong>{' '}
                {files.length ? files.map((f) => f.name).join(', ') : '—'}
              </p>
              <p className="muted mono" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
                {documentPackageHash.slice(0, 24)}…
              </p>
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={hasQualifiedSignature}
                onChange={(e) => {
                  setHasQualifiedSignature(e.target.checked);
                  setSigVerify(null);
                }}
              />
              {t('tok.s2.checkbox')}
            </label>
            <label htmlFor="sigMode">{t('tok.s2.mode')}</label>
            <select
              id="sigMode"
              value={sigMode}
              onChange={(e) => {
                setSigMode(e.target.value as 'institutional_attestation' | 'x509_detached');
                setSigVerify(null);
              }}
            >
              <option value="institutional_attestation">{t('tok.s2.mode.attest')}</option>
              <option value="x509_detached">{t('tok.s2.mode.x509')}</option>
            </select>
            <label htmlFor="signer">Signer / seal id (optional)</label>
            <input
              id="signer"
              value={signerId}
              onChange={(e) => setSignerId(e.target.value)}
              placeholder="NAPR / notary / institution seal reference"
            />
            {sigMode === 'institutional_attestation' ? (
              <>
                <label htmlFor="att">Signature attestation (required)</label>
                <textarea
                  id="att"
                  rows={3}
                  value={signatureAttestation}
                  onChange={(e) => setSignatureAttestation(e.target.value)}
                  placeholder="QES reference, serial, or verification page note (min 8 characters)"
                />
              </>
            ) : (
              <>
                <label htmlFor="leafPem">Signer certificate PEM (leaf)</label>
                <textarea
                  id="leafPem"
                  rows={5}
                  className="mono"
                  value={signerCertificatePem}
                  onChange={(e) => setSignerCertificatePem(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
                <label htmlFor="sigB64">Detached signature (Base64 over package hash bytes)</label>
                <textarea
                  id="sigB64"
                  rows={3}
                  className="mono"
                  value={signatureBase64}
                  onChange={(e) => setSignatureBase64(e.target.value)}
                  placeholder="Base64 RSA-SHA256 / ECDSA signature"
                />
                <label htmlFor="chainPem">Intermediate chain PEM (optional)</label>
                <textarea
                  id="chainPem"
                  rows={3}
                  className="mono"
                  value={certificateChainPem}
                  onChange={(e) => setCertificateChainPem(e.target.value)}
                  placeholder="Optional intermediates"
                />
              </>
            )}
            <div className="actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setStep(1);
                  setSigVerify(null);
                }}
              >
                {t('common.back')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  sigBusy ||
                  !hasQualifiedSignature ||
                  documentPackageHash.length !== 64 ||
                  (sigMode === 'institutional_attestation'
                    ? signatureAttestation.trim().length < 8
                    : signerCertificatePem.trim().length < 32 ||
                      signatureBase64.trim().length < 16)
                }
                onClick={() => void confirmSignature()}
              >
                {sigBusy ? '…' : t('tok.s2.next')}
              </button>
            </div>
          </>
        )}

        {/* ——— 3. FIELDS FROM DOCUMENT (not free invention) ——— */}
        {step === 3 && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('tok.s3.h')}</h2>
            {sigVerify?.verified && (
              <div className="banner ok">
                Signature confirmed · mode{' '}
                <code className="mono">{sigVerify.mode ?? 'attestation'}</code> · id{' '}
                <code className="mono">{sigVerify.verificationId}</code>
                {sigVerify.signer?.subject && (
                  <>
                    <br />
                    <span className="muted" style={{ fontSize: '0.85rem' }}>
                      Signer: {sigVerify.signer.subject}
                      {sigVerify.chainDepth != null ? ` · chain depth ${sigVerify.chainDepth}` : ''}
                    </span>
                  </>
                )}
                <br />
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  Enter only facts that appear on the verified package. Assist below is optional —
                  you confirm.
                </span>
              </div>
            )}
            {extractHints && (
              <div className="card flat" style={{ marginBottom: '1rem' }}>
                <p style={{ marginTop: 0 }}>
                  <strong>Document assist</strong>{' '}
                  <span className="muted">({extractHints.mode})</span>
                </p>
                {extractHints.notes?.map((n) => (
                  <p key={n} className="muted" style={{ margin: '0.25rem 0', fontSize: '0.88rem' }}>
                    {n}
                  </p>
                ))}
                <div className="actions" style={{ marginTop: '0.5rem' }}>
                  {extractHints.suggestedValuation && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        setAmountFromDocument(extractHints.suggestedValuation!)
                      }
                    >
                      Use amount {extractHints.suggestedValuation}
                    </button>
                  )}
                  {extractHints.suggestedHolderId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setHolderId(extractHints.suggestedHolderId!)}
                    >
                      Use holder {extractHints.suggestedHolderId}
                    </button>
                  )}
                  {extractHints.suggestedAssetId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setAssetId(extractHints.suggestedAssetId!)}
                    >
                      Use asset id
                    </button>
                  )}
                </div>
                {extractHints.amountsFound?.length > 1 && (
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    Other amounts seen: {extractHints.amountsFound.slice(0, 5).join(', ')}
                  </p>
                )}
                {extractHints.textPreview && (
                  <details style={{ marginTop: '0.5rem' }}>
                    <summary className="muted" style={{ cursor: 'pointer' }}>
                      Text preview from package
                    </summary>
                    <pre className="result" style={{ maxHeight: 160, fontSize: '0.75rem' }}>
                      {extractHints.textPreview}
                    </pre>
                  </details>
                )}
              </div>
            )}
            <p className="muted">
              Open the PDF, transfer official figures, use assist buttons only if they match the
              paper.
            </p>

            <p className="muted">
              Asset type locked from step 0: <strong>{evidenceDef?.label ?? assetType}</strong>
            </p>

            <div className="callout" style={{ marginBottom: '1rem' }}>
              <strong>Amount + currency only (from the paper)</strong>
              <br />
              Enter what is written on the signed document. You do <strong>not</strong> invent an ARO
              exchange rate or “final network price” before the process ends.
              <br />
              After PoT, Core records the <strong>same figure</strong> as ARO units (fixed 1:1
              mapping of the document number). Currency is the label of the source unit (USD, EUR,
              GEL…). AST does not set market FX.
            </div>

            <div className="grid2">
              <div>
                <label htmlFor="docAmount">Amount from document</label>
                <input
                  id="docAmount"
                  className="mono"
                  value={amountFromDocument}
                  onChange={(e) => setAmountFromDocument(e.target.value)}
                  placeholder="e.g. 150000 or 150000.50"
                  required
                />
              </div>
              <div>
                <label htmlFor="currency">Currency on document</label>
                <select
                  id="currency"
                  value={valuationCurrency}
                  onChange={(e) =>
                    setValuationCurrency(e.target.value as ValuationCurrencyCode)
                  }
                >
                  {VALUATION_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="card flat" style={{ marginBottom: '1rem' }}>
              <div className="muted">Network record after PoT (automatic, not your guess)</div>
              <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 650 }}>
                {aroMintAmount
                  ? `${aroMintAmount} ARO  ←  ${amountFromDocument || '…'} ${valuationCurrency}`
                  : '—'}
              </div>
              <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.82rem' }}>
                No extra rate field. Initiator only restates document amount + currency.
              </p>
            </div>

            <div className="grid2">
              <div>
                <label htmlFor="holder">Rights holder from document</label>
                <input
                  id="holder"
                  value={holderId}
                  onChange={(e) => setHolderId(e.target.value)}
                  placeholder="owner id as on the extract"
                  required
                />
              </div>
              <div>
                <label htmlFor="asset2">Asset id (optional)</label>
                <input
                  id="asset2"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  placeholder="cadastral / internal id"
                />
              </div>
            </div>

            <label htmlFor="wallet">Crypto wallet (optional, for certificate / wallets)</label>
            <input
              id="wallet"
              className="mono"
              value={holderWallet}
              onChange={(e) => setHolderWallet(e.target.value)}
              placeholder="0x… EVM address (MetaMask etc.)"
              spellCheck={false}
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
              Not SoT. Binds wallet-compatible certificate export (EIP-681 / ERC-721 metadata). On-chain
              mint is a future adapter.
            </p>
            <label htmlFor="note">Note (optional)</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />

            <label className="inline">
              <input
                type="checkbox"
                checked={fieldsFromDocument}
                onChange={(e) => setFieldsFromDocument(e.target.checked)}
              />
              I declare these values are taken from the verified signed document (not free
              appraisal by the portal user)
            </label>

            <div className="actions">
              <button type="button" className="secondary" onClick={() => setStep(2)}>
                {t('common.back')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!step3Ok}
                onClick={() => setStep(4)}
              >
                {t('tok.s3.next')}
              </button>
            </div>
          </>
        )}

        {/* ——— 4. ENRICHMENT (bureau signals) ——— */}
        {step === 4 && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('tok.s4.h')}</h2>
            <p className="muted">
              Optional check against an enrichment gateway (mock by default; live bureau such as a
              credit/asset data provider via <code>AST_ENRICHMENT_URL</code>). Signals help you
              confirm identity / asset presence — they do <strong>not</strong> set the mint amount.
            </p>
            <div className="actions" style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                className="secondary"
                disabled={enrichBusy}
                onClick={() => void runEnrichment()}
              >
                {enrichBusy ? 'Checking…' : 'Run enrichment check'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEnrichment(null);
                  setEnrichmentConfirmed(true);
                }}
              >
                Skip enrichment
              </button>
            </div>
            {enrichment && (
              <div className="card flat">
                <p style={{ marginTop: 0 }}>
                  <strong>Provider:</strong> {enrichment.provider} ·{' '}
                  <code className="mono">{enrichment.enrichmentId}</code>
                </p>
                <p>
                  Identity match: <strong>{enrichment.signals.identityMatch}</strong>
                </p>
                <p>
                  Asset presence: <strong>{enrichment.signals.assetPresence}</strong>
                </p>
                <p>
                  Value context: <strong>{enrichment.signals.valueContext}</strong>
                </p>
                <ul>
                  {enrichment.signals.notes.map((n) => (
                    <li key={n} className="muted">
                      {n}
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  {enrichment.disclaimer}
                </p>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={enrichmentConfirmed}
                    onChange={(e) => setEnrichmentConfirmed(e.target.checked)}
                  />
                  I have reviewed enrichment signals; institutional documents remain the source of
                  valuation
                </label>
              </div>
            )}
            {enrichmentConfirmed && !enrichment && (
              <p className="ok">Enrichment skipped — package documents remain sole valuation source.</p>
            )}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setStep(3)}>
                {t('common.back')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={!step4Ok}
                onClick={() => setStep(5)}
              >
                {t('tok.s4.next')}
              </button>
            </div>
          </>
        )}

        {/* ——— 5. START ——— */}
        {step === 5 && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('tok.s5.h')}</h2>
            <div className="card flat">
              <p style={{ marginTop: 0 }}>
                <strong>Asset type:</strong> {evidenceDef?.label ?? assetType}
              </p>
              <p>
                <strong>Document package:</strong>{' '}
                {files.map((f) => f.name).join(', ') || '—'}
              </p>
              <p>
                <strong>Signature:</strong>{' '}
                {sigVerify?.verified ? (
                  <span className="ok">confirmed · {sigVerify.verificationId}</span>
                ) : (
                  '—'
                )}
              </p>
              <p>
                <strong>Document amount:</strong>{' '}
                <span className="mono">
                  {amountFromDocument} {valuationCurrency}
                </span>
              </p>
              <p>
                <strong>Network ARO (auto 1:1 of document figure):</strong>{' '}
                <span className="mono">{aroMintAmount}</span>
              </p>
              <p>
                <strong>Holder (from package):</strong> {holderId}
              </p>
              <p>
                <strong>Enrichment:</strong>{' '}
                {enrichment
                  ? `${enrichment.provider} · ${enrichment.enrichmentId}`
                  : enrichmentConfirmed
                    ? 'skipped'
                    : '—'}
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Submit → portal edge → Core → PoT → NodeChain. You receive a digitization
                certificate on the next screen.
              </p>
            </div>
            <label htmlFor="idem">Idempotency key</label>
            <input
              id="idem"
              className="mono"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
            <div className="actions">
              <button type="button" className="secondary" onClick={() => setStep(4)}>
                {t('common.back')}
              </button>
              <button className="primary" type="submit" disabled={!canSubmit || busy}>
                {busy ? t('tok.s5.busy') : t('tok.s5.submit')}
              </button>
            </div>
          </>
        )}

        {error && <p className="err">{error}</p>}
      </form>
    </div>
  );
}
