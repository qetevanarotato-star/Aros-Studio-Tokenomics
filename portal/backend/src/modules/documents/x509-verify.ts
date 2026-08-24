/**
 * D4 — X.509 detached signature verification over document package hash.
 * Fail-closed. Trust anchors from env/dir. No mint. No national QTSP profiles here.
 */
import { createHash, createVerify, X509Certificate } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type X509VerifyOk = {
  ok: true;
  mode: 'x509_detached';
  subject: string;
  issuer: string;
  serialNumber: string;
  fingerprint256: string;
  notBefore: string;
  notAfter: string;
  chainDepth: number;
  trustAnchorFingerprint256: string;
  verificationMaterial: string;
};

export type X509VerifyErr = {
  ok: false;
  code: string;
  message: string;
};

export type X509VerifyInput = {
  documentPackageHash: string;
  signerCertificatePem: string;
  signatureBase64: string;
  certificateChainPem?: string | string[];
  /** Bind leaf CN/O to institution id when AST_X509_BIND_INSTITUTION=1 */
  institutionId?: string;
};

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function extractPemCertificates(pemBundle: string): string[] {
  const m = pemBundle.match(PEM_RE);
  return m ?? [];
}

export function loadTrustAnchorsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): X509Certificate[] {
  const anchors: X509Certificate[] = [];
  const seen = new Set<string>();

  const addPem = (pem: string, label: string) => {
    for (const block of extractPemCertificates(pem)) {
      try {
        const c = new X509Certificate(block);
        const fp = c.fingerprint256;
        if (seen.has(fp)) continue;
        seen.add(fp);
        anchors.push(c);
      } catch {
        throw new Error(`invalid trust PEM (${label})`);
      }
    }
  };

  if (env.AST_X509_TRUST_PEMS?.trim()) {
    addPem(env.AST_X509_TRUST_PEMS, 'AST_X509_TRUST_PEMS');
  }

  const trustFile = env.AST_X509_TRUST_FILE?.trim();
  if (trustFile && fs.existsSync(trustFile)) {
    addPem(fs.readFileSync(trustFile, 'utf8'), trustFile);
  }

  const trustDir = env.AST_X509_TRUST_DIR?.trim();
  if (trustDir && fs.existsSync(trustDir)) {
    const names = fs.readdirSync(trustDir).filter((n) => /\.(pem|crt|cer)$/i.test(n));
    for (const n of names.sort()) {
      addPem(fs.readFileSync(path.join(trustDir, n), 'utf8'), n);
    }
  }

  // Dev convenience: repo demo trust if nothing configured
  if (anchors.length === 0 && env.AST_X509_USE_DEMO_TRUST !== '0') {
    const candidates = [
      path.resolve(process.cwd(), 'fixtures/x509-demo/trust'),
      path.resolve(process.cwd(), '../fixtures/x509-demo/trust'),
      path.resolve(process.cwd(), '../../fixtures/x509-demo/trust'),
      path.resolve(__dirname, '../../../../../fixtures/x509-demo/trust'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        const names = fs.readdirSync(dir).filter((n) => /\.(pem|crt|cer)$/i.test(n));
        for (const n of names.sort()) {
          try {
            addPem(fs.readFileSync(path.join(dir, n), 'utf8'), `demo:${n}`);
          } catch {
            /* skip bad */
          }
        }
        if (anchors.length > 0) break;
      }
    }
  }

  return anchors;
}

export function allowSelfSigned(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AST_X509_ALLOW_SELF_SIGNED === '1' || env.AST_X509_ALLOW_SELF_SIGNED === 'true';
}

export function requireX509(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AST_REQUIRE_X509 === '1' || env.AST_REQUIRE_X509 === 'true';
}

export function bindInstitution(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AST_X509_BIND_INSTITUTION === '1' || env.AST_X509_BIND_INSTITUTION === 'true';
}

function parseCert(pem: string, code: string): X509Certificate | X509VerifyErr {
  try {
    return new X509Certificate(pem.trim());
  } catch {
    return { ok: false, code, message: 'invalid certificate PEM' };
  }
}

function certValidNow(cert: X509Certificate, now = new Date()): X509VerifyErr | null {
  const from = new Date(cert.validFrom);
  const to = new Date(cert.validTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, code: 'X509_CERT_INVALID', message: 'certificate validity dates unreadable' };
  }
  if (now < from || now > to) {
    return {
      ok: false,
      code: 'X509_CERT_EXPIRED',
      message: `certificate not valid at now (notBefore=${cert.validFrom}, notAfter=${cert.validTo})`,
    };
  }
  return null;
}

function issuerMatches(child: X509Certificate, issuer: X509Certificate): boolean {
  // Prefer cryptographic checkIssued when available
  try {
    if (typeof child.checkIssued === 'function' && child.checkIssued(issuer)) {
      return true;
    }
  } catch {
    /* fall through */
  }
  return child.issuer === issuer.subject;
}

function verifySignedBy(child: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return child.verify(issuer.publicKey);
  } catch {
    return false;
  }
}

/**
 * Walk leaf → intermediates → trust anchors. Returns trust anchor used.
 */
export function resolveTrustAnchor(
  leaf: X509Certificate,
  intermediates: X509Certificate[],
  trustAnchors: X509Certificate[],
  allowSelf: boolean,
): { anchor: X509Certificate; depth: number } | X509VerifyErr {
  // Self-signed leaf accepted only when allowed and self-verifies
  const selfOk =
    allowSelf &&
    leaf.issuer === leaf.subject &&
    verifySignedBy(leaf, leaf);

  if (trustAnchors.length === 0) {
    if (selfOk) {
      return { anchor: leaf, depth: 1 };
    }
    return {
      ok: false,
      code: 'X509_TRUST_NOT_CONFIGURED',
      message:
        'no X.509 trust anchors configured — set AST_X509_TRUST_DIR or AST_X509_ALLOW_SELF_SIGNED=1 for local demo',
    };
  }

  // Leaf itself is a trust anchor (pinned cert)
  for (const a of trustAnchors) {
    if (a.fingerprint256 === leaf.fingerprint256) {
      return { anchor: a, depth: 1 };
    }
  }

  // Direct issue by trust anchor
  for (const a of trustAnchors) {
    if (issuerMatches(leaf, a) && verifySignedBy(leaf, a)) {
      return { anchor: a, depth: 2 };
    }
  }

  // One intermediate hop: leaf ← intermediate ← trust
  for (const mid of intermediates) {
    if (!(issuerMatches(leaf, mid) && verifySignedBy(leaf, mid))) continue;
    for (const a of trustAnchors) {
      if (a.fingerprint256 === mid.fingerprint256) {
        return { anchor: a, depth: 2 };
      }
      if (issuerMatches(mid, a) && verifySignedBy(mid, a)) {
        return { anchor: a, depth: 3 };
      }
    }
  }

  // Multi intermediate: simple DFS up to depth 5
  const pool = [...intermediates, ...trustAnchors];
  const visited = new Set<string>([leaf.fingerprint256]);
  type Node = { cert: X509Certificate; depth: number };
  const queue: Node[] = [{ cert: leaf, depth: 1 }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const cand of pool) {
      if (visited.has(cand.fingerprint256)) continue;
      if (!(issuerMatches(cur.cert, cand) && verifySignedBy(cur.cert, cand))) continue;
      const depth = cur.depth + 1;
      if (trustAnchors.some((a) => a.fingerprint256 === cand.fingerprint256)) {
        return { anchor: cand, depth };
      }
      if (depth >= 6) continue;
      visited.add(cand.fingerprint256);
      queue.push({ cert: cand, depth });
    }
  }

  if (selfOk) {
    // Allowed self-signed even when trust store present but no path
    return { anchor: leaf, depth: 1 };
  }

  return {
    ok: false,
    code: 'X509_CHAIN_UNTRUSTED',
    message: 'certificate chain does not terminate at a configured trust anchor',
  };
}

function subjectBindsInstitution(subject: string, institutionId: string): boolean {
  const id = institutionId.trim().toUpperCase();
  if (!id) return true;
  const sub = subject.toUpperCase();
  // CN=PILOT or O=PILOT style
  if (sub.includes(`CN=${id}`) || sub.includes(`O=${id}`) || sub.includes(`OU=${id}`)) {
    return true;
  }
  // Loose: institution id token appears in subject
  return sub.split(/[=\s,/]+/).includes(id);
}

function verifyDetachedSignature(
  leaf: X509Certificate,
  hashHex: string,
  signatureBase64: string,
): X509VerifyErr | null {
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureBase64, 'base64');
  } catch {
    return { ok: false, code: 'X509_SIGNATURE_INVALID', message: 'signatureBase64 not valid base64' };
  }
  if (sig.length < 32) {
    return { ok: false, code: 'X509_SIGNATURE_INVALID', message: 'signature too short' };
  }

  let hashBytes: Buffer;
  try {
    hashBytes = Buffer.from(hashHex, 'hex');
  } catch {
    return { ok: false, code: 'X509_SIGNATURE_INVALID', message: 'documentPackageHash not hex' };
  }
  if (hashBytes.length !== 32) {
    return { ok: false, code: 'X509_SIGNATURE_INVALID', message: 'documentPackageHash must be 32 bytes' };
  }

  const keyType = (leaf.publicKey as { asymmetricKeyType?: string }).asymmetricKeyType;
  const algorithms =
    keyType === 'ec' || keyType === 'ed25519'
      ? ['SHA256', 'RSA-SHA256']
      : ['RSA-SHA256', 'SHA256', 'RSA-SHA512', 'SHA512'];

  for (const algo of algorithms) {
    try {
      const v = createVerify(algo);
      v.update(hashBytes);
      v.end();
      if (v.verify(leaf.publicKey, sig)) {
        return null;
      }
    } catch {
      /* try next */
    }
  }

  // Some signers sign the hex string UTF-8 (interop); accept as secondary
  const hexUtf8 = Buffer.from(hashHex.toLowerCase(), 'utf8');
  for (const algo of algorithms) {
    try {
      const v = createVerify(algo);
      v.update(hexUtf8);
      v.end();
      if (v.verify(leaf.publicKey, sig)) {
        return null;
      }
    } catch {
      /* try next */
    }
  }

  return {
    ok: false,
    code: 'X509_SIGNATURE_INVALID',
    message: 'detached signature does not verify under leaf public key',
  };
}

export function verifyX509Detached(
  input: X509VerifyInput,
  env: NodeJS.ProcessEnv = process.env,
): X509VerifyOk | X509VerifyErr {
  const hash = input.documentPackageHash?.trim().toLowerCase() ?? '';
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return {
      ok: false,
      code: 'MISSING_DOCUMENTS',
      message: 'documentPackageHash required (64 hex SHA-256)',
    };
  }
  if (!input.signerCertificatePem?.trim()) {
    return {
      ok: false,
      code: 'X509_CERT_INVALID',
      message: 'signerCertificatePem required for mode x509_detached',
    };
  }
  if (!input.signatureBase64?.trim()) {
    return {
      ok: false,
      code: 'X509_SIGNATURE_INVALID',
      message: 'signatureBase64 required for mode x509_detached',
    };
  }

  const leafRes = parseCert(input.signerCertificatePem, 'X509_CERT_INVALID');
  if ('ok' in leafRes && leafRes.ok === false) return leafRes;
  const leaf = leafRes as X509Certificate;

  const expired = certValidNow(leaf);
  if (expired) return expired;

  const chainPems: string[] = [];
  if (Array.isArray(input.certificateChainPem)) {
    for (const p of input.certificateChainPem) chainPems.push(...extractPemCertificates(p));
  } else if (input.certificateChainPem?.trim()) {
    chainPems.push(...extractPemCertificates(input.certificateChainPem));
  }

  const intermediates: X509Certificate[] = [];
  for (const p of chainPems) {
    const c = parseCert(p, 'X509_CERT_INVALID');
    if ('ok' in c && c.ok === false) return c;
    intermediates.push(c as X509Certificate);
  }

  let trustAnchors: X509Certificate[];
  try {
    trustAnchors = loadTrustAnchorsFromEnv(env);
  } catch (e) {
    return {
      ok: false,
      code: 'X509_TRUST_NOT_CONFIGURED',
      message: e instanceof Error ? e.message : 'trust load failed',
    };
  }

  const chain = resolveTrustAnchor(leaf, intermediates, trustAnchors, allowSelfSigned(env));
  if ('ok' in chain) return chain;

  const sigErr = verifyDetachedSignature(leaf, hash, input.signatureBase64.trim());
  if (sigErr) return sigErr;

  if (bindInstitution(env) && input.institutionId) {
    if (!subjectBindsInstitution(leaf.subject, input.institutionId)) {
      return {
        ok: false,
        code: 'X509_INSTITUTION_MISMATCH',
        message: `leaf subject does not bind to institution ${input.institutionId}`,
      };
    }
  }

  const material = createHash('sha256')
    .update(`${leaf.fingerprint256}:${hash}:${chain.anchor.fingerprint256}`)
    .digest('hex')
    .slice(0, 32);

  return {
    ok: true,
    mode: 'x509_detached',
    subject: leaf.subject,
    issuer: leaf.issuer,
    serialNumber: leaf.serialNumber,
    fingerprint256: leaf.fingerprint256,
    notBefore: leaf.validFrom,
    notAfter: leaf.validTo,
    chainDepth: chain.depth,
    trustAnchorFingerprint256: chain.anchor.fingerprint256,
    verificationMaterial: material,
  };
}
