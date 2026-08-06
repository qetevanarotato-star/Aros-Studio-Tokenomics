# Product phases A–J (owner roadmap)

**Status:** Canonical sequencing for **field productization** after engineering v1 core.  
**Law:** [`AST-CORE-CANON.md`](AST-CORE-CANON.md) · decisions [`P0-P4-TECHNICAL-DECISIONS.md`](P0-P4-TECHNICAL-DECISIONS.md)  
**Engineering track (code on main):** [`BUILD_SCHEDULE.md`](BUILD_SCHEDULE.md) · [`COMPLETION-TRACK.md`](COMPLETION-TRACK.md) · [`ROADMAP.md`](ROADMAP.md)

This file is **not** a claim that phases B–J are Done.  
Each phase has **acceptance evidence**. Do not mark Done for docs-only or empty UI.

**Chat language with owner:** Russian. **Repo text:** English.

---

## 0. Overview

| Phase | Name | One-line goal | Depends on |
|-------|------|---------------|------------|
| **A** | Stable edge | Permanent HTTPS, real secrets, no quick tunnel | Repo pilot works |
| **B** | Two-sided pilot | Two live parties on one `processId` path | **A** |
| **C** | Trust crypto | Real X.509/QTSP or mTLS/OIDC — not checkbox | **A** (stronger with B) |
| **D** | Ops control plane | Live process + NodeChain console (not mock) | **A** (ideal after B) |
| **E** | External audit | Firm engagement, report, remediations | **A** min; better after C/D |
| **F** | Bank/PSP sandbox | Fiat evidence + webhooks → E2E process | **A+C** legal green light |
| **G** | Representation chain | Optional ERC/NFT **mirror**; NodeChain remains SoT | **A**; after E preferred |
| **H** | Multi-node / quorum ops | Standing validators, replication, KMS | **A+D**; after E preferred |
| **I** | Field release | Policy, partial release, monitoring, DR evidence | **A–H** as required by scope |
| **J** | Scale / BFT later | Network hardening | **Only after A–I** |

```
A ──► B ──► C
 │     │
 └──► D ──► E ──► F
              │
              ├──► G
              └──► H ──► I ──► J
```

Parallel allowed: **D** next to **B/C**; **G** and **H** after **E** in parallel; never **J** before **I**.

---

## A — Stable edge

| | |
|--|--|
| **Goal** | Permanent URL, TLS, `AST_ALLOW_DEMO=0`, real institution secrets, login without quick tunnel |
| **Done when** | `https://<host>/login` works; preflight pass; health green; secrets not in git |
| **Package** | [`portal/STABLE-EDGE-A.md`](portal/STABLE-EDGE-A.md) · [`cutover/E1-DOMAIN.md`](cutover/E1-DOMAIN.md) · [`cutover/E2-SECRETS.md`](cutover/E2-SECRETS.md) · `docker-compose.prod.yml` |
| **Owner** | Domain + VPS + DNS |
| **Non-goals** | Second party, bank rails, NFT-in-wallet |

---

## B — Two-sided pilot

| | |
|--|--|
| **Goal** | **Two live parties** on one `processId` path |
| **Modes (pick at least one)** | (1) **Two institutions** (issuer + counterparty/registrar) allowlisted; (2) **Institution + holder** role (holder sees process/certificate/wallet bind; cannot mint) |
| **Done when** | Process created by party 1; party 2 can authenticate and act/view on **same** `processId` (status, package, cert, public explore); audit trail shows both parties where required |
| **Existing today** | Multi-institution secrets file; holderId + holderWallet on process; public explore; certificate bind — **not** full dual workflow UI |
| **Build / ops** | Second institution in `setup-institution-secrets`; optional holder session role at edge; dual-party process type rules (Canon process types); document who signs what |
| **Docs to extend** | `INSTITUTION-SECRETS.md` · Asset tokenization primary process · new `docs/portal/TWO-SIDED-PILOT-B.md` (when implementing) |
| **Non-goals** | Public marketplace; free self-signup; portal mint |

**Investor story:** “Not a single-bank demo — two authenticated parties on one process.”

---

## C — Trust crypto

| | |
|--|--|
| **Goal** | Document and institution identity are **cryptographically real**, not UI checkbox |
| **Done when** | (1) X.509/QES path verifies package hash against **production trust anchors** (or QTSP profile), **or** (2) mTLS client cert / OIDC IdP maps to institution allowlist in pilot-prod; fail-closed on bad sig |
| **Package** | [`portal/QES-X509-D4.md`](portal/QES-X509-D4.md) · [`portal/MTLS-OIDC-D6.md`](portal/MTLS-OIDC-D6.md) · fixtures residual → real roots |
| **Owner** | QTSP/CA materials; IdP tenant; counsel on eIDAS/national profiles |
| **Non-goals** | Full national IdP federation day-one; CMS/PAdES every format (track residuals) |

**Rule:** `hasQualifiedSignature: true` without verify = **not** phase C Done.

---

## D — Ops control plane

| | |
|--|--|
| **Goal** | Operator console = **real-time reflection** of Core + NodeChain + edge processes — not empty Framer chrome |
| **Done when** | Live boards: process list/status/PoT/mint lag; NodeChain tip/height/nodes; chain.ok; kill-switch visibility; metrics; role `operator` separate from institution cabinet; data from real APIs (`/v1/processes`, `/v1/public/nodechain/*`, core status/metrics) |
| **Existing today** | Cabinet lists processes; `/nodechain` UI; public status; health — **not** full ops role or multi-tenant control |
| **Build** | Spec first: `docs/portal/CONTROL-PLANE-SPEC.md` → UI + API aggregation; poll/SSE; **no** mint/veto buttons (All-Seeing Eye observe only) |
| **Non-goals** | Eye executive powers (Canon out); fake dashboards with hard-coded heights |

**Investor story:** “We operate and observe the ledger live — same tip height as the API.”

---

## E — External audit

| | |
|--|--|
| **Goal** | Independent security/process review + remediations |
| **Done when** | Engagement letter; access to evidence env; written report; tracked remediations closed or accepted risk |
| **Package** | [`hardening/EXTERNAL-AUDIT-F1.md`](hardening/EXTERNAL-AUDIT-F1.md) · [`AUDIT-PREP-F2.md`](AUDIT-PREP-F2.md) |
| **Owner** | Select firm, NDA, scope (SoT, portal edge, keys, deploy) |
| **Non-goals** | Self-audit as substitute |

Prefer after **A+C+D** so auditors see real deploy and trust path.

---

## F — Bank / PSP sandbox

| | |
|--|--|
| **Goal** | Fiat **evidence** + webhooks into process E2E in **sandbox** (not custody of third-party funds as product claim) |
| **Done when** | Sandbox credentials; event map (payment settled → evidence on process); fail-closed; E2E script/runbook; processId linkable to payment reference |
| **Canon** | AST is **not** custodian; mint still only after PoT; bank account of **company** ≠ NodeChain SoT |
| **Owner** | Counsel + bank/PSP KYB + sandbox API |
| **Non-goals** | Production wire settlement; auto-mint on payment without PoT |

---

## G — Representation chain

| | |
|--|--|
| **Goal** | Optional on-chain **mirror** (ERC view / NFT metadata) so wallets can **display** representation; **NodeChain remains SoT** |
| **Done when** | Deployed view or mint-mirror on testnet (or agreed chain); metadata URI tied to process/certificate; docs state non-SoT; no free mint authority |
| **Package** | [`portal/WALLET-COMPAT.md`](portal/WALLET-COMPAT.md) · [`contracts/SOLIDITY-BLOCK-E.md`](contracts/SOLIDITY-BLOCK-E.md) · `ArosCoinView` tip attest |
| **Non-goals** | ERC balances as economic authority; public ARO market listing (Block H out) |

---

## H — Multi-node / quorum ops

| | |
|--|--|
| **Goal** | Standing validators/nodes, replication, KMS — not single laptop journal |
| **Done when** | ≥ N admitted nodes with roles; quorum PoT path in field; journal replication/catch-up; `AST_KEY_PROVIDER=hsm` or real KMS path documented and exercised; heartbeats/standing |
| **Package** | NodeChain identity docs · hardening KMS F2 · journal replicator · node registry |
| **Non-goals** | Full BFT mainnet (that is **J**) |

---

## I — Field release

| | |
|--|--|
| **Goal** | Operable production field: policy, partial release, monitoring, DR **evidence** |
| **Done when** | Runbooks; monitoring wired; backup/restore drill signed; kill-switch drill; field tag/compose per [`FIELD-RELEASE-F4.md`](FIELD-RELEASE-F4.md); go-live card [`GO-LIVE-F1.md`](GO-LIVE-F1.md) |
| **Package** | F4 field release · F5 DR drill · F6 monitoring · partial-release process in core |
| **Non-goals** | Infinite feature scope creep before first field cut |

---

## J — Scale / BFT later

| | |
|--|--|
| **Goal** | Network hardening toward multi-node BFT / scale |
| **Done when** | Explicit design + acceptance for BFT era (future canon amendment if needed); load and fault targets met |
| **Rule** | **Only after A–I** for the scope you ship; see Block H residual multi-node BFT |
| **Non-goals** | Starting J before stable edge and audit |

---

## Status board (fill as you go)

| Phase | Status | Evidence / date | Owner note |
|-------|--------|-----------------|------------|
| A Stable edge | **Open** (package ready) | | |
| B Two-sided pilot | Open | | |
| C Trust crypto | Open (D4/D6 residual) | | |
| D Ops control plane | Open (partial UI exists) | | |
| E External audit | Open (prep ready) | | |
| F Bank/PSP sandbox | Open | | |
| G Representation chain | Open (wallet + view package) | | |
| H Multi-node / quorum | Open (core capable; field residual) | | |
| I Field release | Open | | |
| J Scale / BFT | Deferred | | |

Optional chat marks: `A stable edge live` · `B two-sided pilot` · `E audit engaged` · etc. (no secrets in chat).

---

## What to show investors by phase

| Phase live | Investor can see |
|------------|------------------|
| A | Permanent HTTPS product, real login, process → cert |
| B | Two parties on one process |
| C | Real crypto verification of documents/identity |
| D | Live ops console = journal truth |
| E | Third-party audit posture |
| F | Fiat rails in sandbox (regulated story) |
| G | Wallet-visible mirror (with SoT disclaimer) |
| H–I | Production-grade network + runbooks |
| J | Long-term network ambition only |

---

## Implementation rule (hard)

1. **Docs / spec first** for any new module (especially B dual roles, D control plane, F webhook schema).  
2. **No fake Done** — acceptance with live evidence.  
3. Portal **never** mints; significant events **must** hit NodeChain.  
4. Prefer finishing **A** before promising B–J dates.

---

## Next recommended order (default)

1. **Close A** (VPS + domain) — card: [`portal/STABLE-EDGE-A.md`](portal/STABLE-EDGE-A.md)  
2. **Spec B** (two institutions vs institution+holder) + **spec D** control plane screens  
3. **C** trust anchors / IdP in parallel with B  
4. **E** when deploy + trust path are real  
5. **F / G / H** by business priority after E  
6. **I** field cut · **J** later  

---

**End of product phases A–J.**
