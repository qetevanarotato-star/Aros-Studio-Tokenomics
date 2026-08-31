# P0–P4 Technical Decisions (canonical)

**Status:** Canonical for v1  
**Date:** 2026-07-16  
**Source of truth (law):** `docs/AST-CORE-CANON.md`  
**Detail packs:** `docs/components/*`  
**Full questionnaire archive:** `docs/COMPONENT_CLARIFICATIONS.md`

This file is the **decision register** used by build schedule Phase 0+. It does not replace the Core Canon.

---

## P0 — Core economic modules

### invariants

- Set = I1–I9 in Core Canon §XI; new invariants only via formal canon update (semver).  
- Pure predicates **and** hard write-path guards (fail-closed).  
- Any component asserts before side-effect; All-Seeing Eye only observes.  
- On breach: fail-closed + NodeChain record; **no** All-Seeing Eye veto/rollback.  
- Versioned ids `I-ID-vX.Y`; all critical; every invariant has CI tests.  
- Supply conservation: online hard gate + offline reconciliation.  
- Selective custody as machine rules.  
- API: `assertInvariant` + `checkAll` + `InvariantBroken`.

### pot

- Evidence: processId, ExecutionSnapshot (hash+prevHash), validatorIds, qualified signatures, criteriaResult P1–P4.  
- Quorum M-of-N (default 2/3); binary `verified` 0|1; final when 1.  
- Timeout 15m → expired → new processId.  
- Uniqueness processId + ledgerHeight ordering.  
- Quorum validators submit; orchestrator coordinates only.  
- NodeChain record **before** emission.  
- No amount math in pot.  
- Double confirm → error + All-Seeing Eye-visible record.

### reserve

- Multi-asset; AST books only (own funds).  
- Units + arx + snapshot rate at PoT.  
- One bag, many claims; reserve service + contract lock.  
- Partial release = child records; insufficient → hard fail.  
- Internal API v1; NodeChain primary, Solidity mirror.  
- `reserveIndex = log10(1 + totalProcessVolume)`.

### aroscoin

- ARO / 9 decimals; transfer inside AST via PoT.  
- Split by amount + dust; processId + claimId.  
- Double-mint both TS and Solidity; reassign only burn+remint.  
- Optional claim expiry; rate from institutional input.  
- Mint only emission-after-PoT; privileged mint forbidden forever.  
- NodeChain before client ack.

---

## P1 — Network, emission, settlement, All-Seeing Eye

### nodechain

- Linear append-only main chain; DAG only inside one processId.  
- Primary durable store target RocksDB; Postgres index mirror only.  
- Word “blocks” forbidden in product API.  
- No sharding v1; encryption at rest required.  
- Append: internal roles + quorum validators.  
- Institution read: own processes only.  
- Immediate immutability; content hashes + processId.  
- BFT later; PoT+quorum enough v1.

### nodes

- Cert (КЭП/X.509) + key pair; manual approval + allowlist.  
- mTLS + signed challenges; JWT internal only.  
- Fixed roles: executor, confirmer, observer.  
- Suspend = reputation + quorum exclude + 24h grace (no slashing).  
- Heartbeats; min uptime default 95%; geo configurable.  
- Payment in ARO post-factum; multi-node per institution; 1 vote per cert.

### asset token (rights)

- **Permanent** (ratified 2026-08-31). Does not extinguish at process close.  
- Distinct from ArosCoin. Process timeout ≠ token expiry.  
- Supply change only via PoT-gated revaluation mint/burn.

### emission

- Institutional valuation + ΔValue (replaces α·TV+β·U+γ).  
- Output ARO; floor 9 decimals; deterministic from NodeChain.  
- Caps per asset class; calls aroscoin.mint after PoT.  
- Zero ΔValue → emit zero or burn per asset policy.  
- Params only via canon/governance; pro-rata computed in emission.

### commission

- Multi-schedule; base = valuation; on PoT; currency ARO.  
- Default split 70% nodes / 30% AST; full simple distribution engine.  
- NodeChain visibility mandatory.  
- API names: `settleCommission`, `distributeNodePayment` (no banned yield tokens).  
- Waivers/tiers configurable; sandbox feeRate example 0.15%.

### all-seeing-eye

- All events; async batch + critical sync alerts.  
- Consumers: ops + orchestrator.  
- Reason codes required; fail-closed owned by executing module.  
- Separate process deployment; NodeChain + analytic mirror (lag ≤ 30s).  
- Disable only non-prod; never mint/burn/pay/veto/rollback.  
- Parallel observation plane only.

---

## P2–P3 — Orchestration, state, release, common

### orchestrator

- Sole economic entry; processId `AST-{INST}-{YYYYMMDD}-` + UUIDv7.  
- Fixed pipeline 9 steps (Start → Docs → Oracle? → PoT → NodeChain → Emission → Settlement → State → End).  
- Compensation saga **only before** verified=1.  
- AI L1 real (docs + basic risk); L2/L3 optional.  
- Optional human approval by policy; mandatory idempotencyKey.  
- Max 10 concurrent processes/institution; process timeout 30m; step default 5m.  
- Logs technical; NodeChain business truth.

### state-recording

- Snapshots **inside** NodeChain (same SoT).  
- Schema: processId, sequenceId, timestamp, stateType, payloadHash, prevStateHash, validatorId, status.  
- Write-ahead; immutable forever; encrypt sensitive; no redaction.  
- Own-process query; processId mandatory; fail-closed if record fails; replay tool.

### release

- System + governance; daemon initiates on thresholds.  
- Config keys `release.threshold`, `release.target` (no hard-coded numbers).  
- Pre-phase block: free external transfer, CEX listing, public trading.  
- Post-phase: external transfer, bridge, listing (+ compliance).  
- Partial asset release = **separate** module.  
- Full atomicity with burn/reserve; reverse via governance + NodeChain.

### common

- Money/decimal, ids, errors, crypto, types, logging, config.  
- No domain rules; barrel exports only; testing/ separate.  
- decimal.js; semver deprecate-not-delete in v1.

---

## P4 — Gaps closed

### PoT Criteria P1–P4 (also in Core Canon §4.2)

| ID | Meaning |
|----|---------|
| P1 | Allowed context (valid institutional cert + allowlist) |
| P2 | Full execution stage sequence completed |
| P3 | Significant states on NodeChain |
| P4 | Completed under process-type rules (deterministic) |

All four always; fail any → verified=0 + reason codes; formal text in Core Canon.

### partial-release

- Folder `partial-release`; holder + institutional approval; full new processId.  
- Dust = ARO; atomic burn + reserve child + remint; internal pre-phase.  
- Pro-rata impact; lighter governance than phase change.

### Support modules

| Module | v1 |
|--------|-----|
| release_daemon | real |
| velocity_tracker | real |
| node_reputation | real |
| resource_monitor | not in v1 scope |
| ledger vs nodechain | one binary |
| oracle_gateway | multi-oracle + signatures; fail-closed |
| settlement | alias of commission |
| portal | **institutional edge v1** under `portal/` (Next.js UI + Nest BFF + OpenAPI); session auth, hash, Core hand-off; not SoT |

### Cross-cutting defaults (also Core Canon §XII)

PoT timeout 15m; step timeout 5m; grace 24h; dust 1e-9 ARO; commission 70/30; RocksDB preferred; UTC; envs local/test/sandbox/prod; kill switch yes; mint ok settle fail → retry settle (no burn-compensate); multi-node = 1 vote/cert.

---

## Use in development

1. Read Core Canon.  
2. Read this register.  
3. Read component pack.  
4. Implement.  
5. If conflict: **Core Canon wins**; stop and ask owner if still ambiguous.
