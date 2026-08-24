# AST Core Canon

**Path:** `docs/AST-CORE-CANON.md` (sole full source of truth)  
**Aros Studio Tokenomics — Final Canon**  
**Version:** 1.0 (Final)  
**Date fixed:** 16 July 2026  
**Status:** Canonical. Changes only through a formal amendment procedure.  
**Language:** English (repository language)

This document is the **source of truth** for AST. All architecture, code, workflows, GitHub Actions, documentation, and agent decisions **must** conform to it. Any deviation is a canon violation.

Root [`CANON.md`](../CANON.md) is a discoverability pointer only.

---

## I. Mission of AST

AST exists to move **already confirmed institutional assets** into a digital network space, creating a reliable, immutable, and programmable registry of rights.

AST’s mission is not to create new value and not to appraise assets, but to **record accurately and reliably** an already existing institutional valuation and rights to the asset in the form of a token that continues to live and change together with the real asset.

---

## II. Nature of AST

AST is a **sovereign process token-economy**.  
It is a standalone legal entity, holds only its **own** value, and is subject to applicable licensing.

AST is **not** a custodian of third-party funds.  
AST is **not** a valuation organization.  
AST **is** the **infrastructure for recording and accompanying** tokenized rights.

---

## III. First principles (immutable)

1. Value arises **only** through a confirmed process (PoT).
2. Payment for executed work is made **only post-factum**.
3. Any significant action without a NodeChain record is **invalid**.
4. Execution is deterministic (same inputs → same result).
5. Emission is possible **only** as part of a confirmed process (pre-mine and free emission are forbidden).
6. What is earned is retained; speculative holding, farming, and staking are forbidden.
7. Circulation of ArosCoin is restricted until Release Phase.

---

## IV. Architectural canons

### 4.1. NodeChain

NodeChain is the **sole source of truth**.  
All significant events (tokenization, value change, transfer of rights, revaluation) **must** be recorded in NodeChain.  
A NodeChain record is the **only** thing that confers validity on an event.  
NodeChain is an append-only immutable ledger with ExecutionSnapshot and cryptographic chaining.

### 4.2. Proof of Transaction (PoT)

PoT is the **only gate** for the origin and change of value.  
Without a positive PoT verdict (`verified = 1`), value does not arise, does not change, and is not recognized as valid.  
PoT is institutional and process validation of the **fact of execution**, not consensus by hash power or stake.

#### PoT Criteria (P1–P4)

All four criteria apply to **every** process type in v1 (no per–asset-class subset).  
They are versioned with the canon semver.  
Evaluators: **quorum validators** + **Orchestrator** (coordination).  
Failure of **any** criterion → immediately `verified = 0` (with mandatory reason codes).  
Formal definitions live **in this canon** (not only in component docs).

| ID | Criterion |
|----|-----------|
| **P1** | The process is initiated in an allowed architectural context (valid institutional certificate + allowlist). |
| **P2** | The full sequence of execution stages has been completed. |
| **P3** | All significant states are recorded in NodeChain. |
| **P4** | The process is completed under the rules of the specific process type (deterministic result). |

`criteriaResult` for a positive verdict requires **all** of P1–P4 to pass.

### 4.3. The All-Seeing Eye

The All-Seeing Eye is an independent monitoring, audit, and alerting layer.  
It does **not** have veto or rollback rights.  
Its function is to **observe**, **record violations**, and **notify**.

### 4.4. Selective Custody

AST may hold **only its own funds** (reserves, commissions, own capitalization).  
Holding participants’ third-party funds is **forbidden**.

---

## V. RWA tokenization canons

### 5.1. Core rules

- AST does **not** appraise assets.
- AST accepts **only** an already confirmed institutional valuation.
- An asset is tokenized at the official price provided by the institution.
- After tokenization, AST (NodeChain) becomes the permanent registry of rights to that asset.

### 5.2. Primary tokenization process

1. The institution provides a document package containing the official asset valuation and a qualified digital signature.
2. The system verifies authenticity of the signature and documents.
   - Portal edge (admission only, never mints): institutional attestation and/or cryptographic **X.509 detached** verification of the document package hash against configured trust anchors (`docs/portal/QES-X509-D4.md`; implementation: `portal/backend/src/modules/documents/x509-verify.ts`). Edge verifies fail-closed: parse leaf PEM, validity window, chain walk leaf→intermediates→trust anchors (`AST_X509_TRUST_DIR` / `AST_X509_TRUST_FILE` / `AST_X509_TRUST_PEMS`), detached signature over the raw 32-byte package hash, optional institution bind (`AST_X509_BIND_INSTITUTION`). `AST_REQUIRE_X509=1` forces `x509_detached` mode. Demo-only self-signed / fixtures trust must never be production defaults. National QTSP/eIDAS profiles, CMS/PAdES-in-PDF, and OCSP/CRL remain residual.
   - Document assist may use optional OCR for image-only scans (`docs/portal/OCR-D5.md`); human confirmation remains mandatory; AST does not appraise.
   - Institution auth at the edge: shared secret (pilot), and/or proxy-terminated **mTLS** map, and/or **OIDC** bearer pilot hooks (`docs/portal/MTLS-OIDC-D6.md`). Full national IdP/JWKS remains residual.
   - Optional infra (Postgres index mirror, Redis session assist, Kafka/event out, JSON logs, K8s skeleton) must not become source of truth — journal remains SoT (`docs/infra/BLOCK-I.md`). Runtime stack remains NestJS (I6 S1).
   - Field go-live and external audit are owner ops after engineering packages (`docs/GO-LIVE-F1.md`, `docs/AUDIT-PREP-F2.md`, `docs/cutover/`); they do not change economic invariants.
   - Optional on-chain `ArosCoinView` may attest journal tip for explorers only — never free mint; never ERC-as-SoT (`docs/contracts/SOLIDITY-BLOCK-E.md`).
3. PoT confirms the fact that a confirmed valuation was provided.
4. NodeChain records creation of the token.
5. Primary minting of tokens occurs **strictly at the fixed institutional price**.

### 5.3. Lifecycle of a tokenized asset

After primary tokenization:

- The asset loses the ability to circulate fully in the traditional regime without updates in AST.
- Any significant event (rise/fall in value, transfer of rights, project development, etc.) **must** pass through AST.
- The traditional registry receives a mark that the asset is tokenized.

---

## VI. Token canons (AST Token Protocol)

### 6.1. Mission of the token

An AST token is a digital carrier of rights to a real asset.  
Its job is to reflect accurately the current state of rights and economic value of the asset in the network space.

### 6.2. Token architecture

AST defines its **own full protocol** — the **AST Token Protocol**.

Structure:

- **Canonical Layer** — token state always lives in NodeChain + PoT (sole source of truth).
- **Abstract Interface Layer** — AST’s own abstract token interface (not bound to Ethereum).
- **Representation Adapters** — plugins for compatibility with ERC-20, ERC-3643, ERC-1400, and any future standards.
- **Cross-Chain Layer** — abstract transport (support for any bridge protocols, current and future).

### 6.3. Token properties

- Future-proof (not dependent on a specific ERC standard).
- Maximally mobile and compatible.
- Fully preserves the AST canon.
- All critical operations (mint, burn, transfer, revaluation) pass through NodeChain + PoT.

### 6.4. Mechanism of token value change

- On confirmed **increase** in asset value → **new emission** of tokens.
- On confirmed **decrease** in asset value → **burn** of tokens.
- New emission is distributed **pro-rata to current holders**.
- Every supply change is bound to a specific confirmed process (PoT) and recorded in NodeChain.

### 6.5. Asset valuation

AST does **not** calculate asset value.  
AST accepts only an already confirmed institutional valuation and uses it as the basis for minting and subsequent changes.

---

## VII. Release Phase

### 7.1. Definition

Release Phase is a defined stage of system maturity at which the circulation regime for ArosCoin and asset tokens expands beyond internal roles (process unit and payment unit).

### 7.2. Activation conditions

Transition into Release Phase is possible **only** when both conditions hold at once:

- `reserveIndex > threshold`
- `velocity > target`

Where:

- `reserveIndex` — logarithmic measure of accumulated capitalization through confirmed work.
- `velocity` — measure of circulation activity.

### 7.3. Activation mechanism

- The `release_daemon` module continuously tracks metrics.
- When conditions hold, Release Phase activates automatically.
- Until activation, tokens exist only in internal roles (process unit + payment unit).
- After activation, a broader (external) circulation regime is possible.

### 7.4. Protection

Until Release Phase, any attempt to take process value into free market circulation is **architecturally blocked**.

---

## VIII. Implementation modules

### 8.1. Core modules

| Module | Purpose |
|--------|---------|
| `proof_of_transaction_engine` | PoT validation of the fact of execution |
| `nodechain_engine` | Process handling, ExecutionSnapshot assembly, validation and append |
| `tokenomics_service` | Emission / burn / accounting of ArosCoin and asset tokens |
| `settlement_controller` | Commission pool and post-factum payment distribution |
| `release_daemon` | Release Phase activation |
| `velocity_tracker` | Velocity calculation |
| `node_reputation_service` | Node reputation and weight |
| `resource_monitor` | Resource intensity and energy cost of operations |
| `ledger` | Append-only journal store (Transaction, ExecutionSnapshot) |

### 8.2. Module rules

- Each module implements strictly its own responsibility zone.
- Modules **must not** bypass NodeChain and PoT.
- All critical operations are logged in NodeChain.

---

## IX. Formulas and calculations

### 9.1. Confirmed volume

```
PoT_volume = Σ(tx.amount × tx.verified)
```

where `tx.verified = 1` only under a positive PoT verdict.

### 9.2. Process reserve index

```
reserveIndex = log10(1 + totalProcessVolume)
```

Soft growth reflecting long-term capitalization through confirmed work.

### 9.3. Internal value estimate (informational)

```
ArosCoin_internalPrice = base × reserveIndex
```

Used only for internal metrics. It is **not** a market price and is **not** used for minting (minting follows institutional valuation).

### 9.4. Transaction fee

```
fee = tx.amount × feeRate
```

### 9.5. Node payment (post-factum)

```
paymentToNode = (node_weight_in_tx × tx.fee) / Σ(node_weights)
```

### 9.6. Circulation velocity

```
velocity = processVolume_24h / circulatingSupply
```

### 9.7. Release Phase condition

```
ReleasePhase = (reserveIndex > threshold) ∧ (velocity > target)
```

### 9.8. Node reputation

```
nodeReputation = (Σ(successful_participations) / Σ(total_participations)) × uptimeFactor
```

### 9.9. Dynamic fee (optional)

```
dynamicFee = fee × (1 + overloadRate)
```

### 9.10. Token supply change principle

- On confirmed value **increase**:  
  `new_supply = current_supply × (1 + ΔValue / previous_value)`
- On confirmed value **decrease**:  
  `new_supply = current_supply × (1 − ΔValue / previous_value)`
- New emission / burn is distributed pro-rata to current holders.

---

## X. Hard prohibitions

- System self-appraisal of assets.
- Pre-mine and free emission.
- Staking, farming, passive income without execution.
- Holding third-party funds.
- All-Seeing Eye rights of **veto** and **rollback**.
- Bypassing NodeChain and PoT on any significant operation involving a tokenized asset.
- Speculative holding.

---

## XI. Invariants

- **I1.** Value arises only when `verified = 1` (PoT).
- **I2.** Every emission / burn is bound to a confirmed process.
- **I3.** Every significant event is recorded in NodeChain.
- **I4.** Determinism: same input → one result.
- **I5.** What is earned is retained; speculative holding is forbidden.
- **I6.** AST holds only its own funds.
- **I7.** The token always reflects the current confirmed value of the asset.
- **I8.** Until Release Phase, circulation is limited to internal roles.
- **I9.** New emission is always distributed pro-rata to current holders.

---

## XII. Operational defaults (v1)

These values are ratified for implementation defaults; changing them is a configuration or canon/governance matter as noted.

| Item | Default |
|------|---------|
| PoT confirmation timeout | 15 minutes |
| Orchestrator per-step timeout | 5 minutes (configurable) |
| Orchestrator process timeout | 30 minutes |
| Node suspend grace period | 24 hours |
| Min ARO dust | 0.000000001 (10⁻⁹ ARO / 1 arx) |
| Commission split (nodes / AST) | 70% / 30% (ship default; configurable) |
| Sandbox example feeRate | 0.15% |
| Release config keys | `release.threshold`, `release.target` (numeric values config-only) |
| Primary ledger engine | RocksDB |
| Money library (TypeScript) | decimal.js |
| processId prefix pattern | `AST-{INST}-{YYYYMMDD}-` (+ UUIDv7 as defined in orchestrator pack) |
| Clock | **UTC only** |
| Environments | `local`, `test`, `sandbox`, `prod` |
| All-Seeing Eye analytic mirror max lag | 30 seconds |
| Kill switch / read-only mode | **yes** in v1 |
| PoT multi-node same institution | **1 vote total** per institutional certificate |
| Compensation after `verified = 1` | **not compensatable** |
| Mint succeeded, settlement failed | **retry settlement** (do not burn-compensate mint) |
| Oracle Gateway failure | **fail-closed** (process expired) |

## XIII. Closing

This document is the **final AST canon**.  
All architectures, code, workflows, GitHub Actions, documentation, and agent decisions **must** conform to it.  
Any deviation is a canon violation.

---

**End of canon.**
