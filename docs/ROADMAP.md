# ROADMAP

## Done — v1.0.0 / v1.1.0 public releases

- Core Canon + P0–P4 decisions  
- Layers 01–10 documentation map  
- NodeChain journal + tokenize pipeline  
- RocksDB / Ed25519 / L1–L3 / guards  
- ENV: Docker, Postgres schema, Solidity view, Rust companion, CI  
- Hardening #68–#70 (soft-HSM, replication catch-up, L3 LLM adapters)  
- **Institutional portal** edge (`portal/`): login, document path, status, certificate  
- **Release packaging:** Docker Compose, GHCR, tags `v1.0.0` / `v1.1.0`  
- **Nodes list** vocabulary (not product “blocks”) — A8 / B5  

## Engineering complete on `main` (2026-07-30)

| Block | Scope |
|-------|--------|
| **A** | Repo hygiene / CI / companions / Nodes vocabulary |
| **B** | NodeChain residuals (B1 package open for owner) |
| **C** | Acceptance depth + operator smoke |
| **D** | Portal pilot finish D1–D12 |
| **E** | Solidity representation (ArosCoinView); free-mint out |
| **F** | Hardening Bar B packages F1–F6 |
| **G** | Documents / process (this sync) |
| **I** | Infra compose / k8s / metrics |

Source: [`docs/COMPLETION-TRACK.md`](COMPLETION-TRACK.md).

## Product field phases A–J (owner-driven)

Full sequencing, acceptance, non-goals: **[`PRODUCT-PHASES-A-J.md`](PRODUCT-PHASES-A-J.md)** · Phase A card: [`portal/STABLE-EDGE-A.md`](portal/STABLE-EDGE-A.md)

| Phase | Name |
|-------|------|
| A | Stable edge (HTTPS, secrets, no quick tunnel) |
| B | Two-sided pilot (2 parties / one processId) |
| C | Trust crypto (QTSP/X.509, mTLS/OIDC) |
| D | Ops control plane (live process + NodeChain) |
| E | External audit |
| F | Bank/PSP sandbox |
| G | Representation chain (ERC/NFT mirror, non-SoT) |
| H | Multi-node / quorum ops |
| I | Field release (runbooks, DR, monitoring) |
| J | Scale / BFT later (only after A–I) |

## Next (owner-driven) — engineering residuals

| Priority | Item | Doc |
|----------|------|-----|
| **P0** | Sign B1 / Canon NodeChain review | `OWNER-REVIEW.md` · reply **`B1 approved`** |
| **P0** | Phase A stable edge live | `portal/STABLE-EDGE-A.md` |
| **P1** | External audit engagement | F1 · `EXTERNAL-AUDIT-F1.md` |
| **P1** | Host cutover + domain | `docs/cutover/` · D8 |
| **P2** | Quarterly restore drill (prod) · monitoring wire | F5 · F6 |
| **P2** | Real KMS/PKCS#11 · multi-region mesh when required | F2 · F3 |
| **P3** | L3 multi-vendor keys in vault · IdP/QTSP | F4 · D6 residual |

## Later (may be AST-adjacent ops)

- Mainnet representation deploy if product needs it  

## Not AST core track (Block H)

| ID | Item | Priority |
|----|------|----------|
| H1 | Outer execution-process API shell (product on AST) | later / separate product |
| H2 | Public market listing of ARO | **out** |
| H3 | Multi-node BFT mainnet | later |
| H4 | Eye veto / executive powers | **out** (Canon) |

Detail: [`docs/docs-process/BLOCK-H.md`](docs-process/BLOCK-H.md).
