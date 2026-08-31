# Aros Studio Tokenomics (AST)

Institutional process token-economy: **NodeChain** is the sole source-of-truth journal; value gates through **PoT**; AST holds only its own funds.

**Release:** [v1.0.0](https://github.com/Aros-Technology-Studio/Aros-Studio-Tokenomics/releases/tag/v1.0.0) · [Release notes](docs/RELEASE.md) · [Changelog](CHANGELOG.md)

## Status

| Area | State |
|------|--------|
| Canon | `docs/AST-CORE-CANON.md` |
| Agent results | `docs/agent-work/` |
| Core | Full economic path (NodeChain → PoT → mint → commission → reserve) |
| Portal | **Institutional client edge** (`portal/`) — login, hash, submit, status |
| Ops | Docker Compose + GHCR images |

## Home access (through your house)

```bash
bash scripts/home-up.sh          # Core + edge + UI on this machine
bash scripts/home-tunnel.sh      # temporary HTTPS (*.trycloudflare.com)
bash scripts/domain-tunnel-setup.sh arosfinancialcore.com   # once: permanent domain
bash scripts/domain-tunnel-up.sh # permanent https://your-domain (see docs/DOMAIN-TUNNEL.md)
```

See [`docs/HOME-ACCESS.md`](docs/HOME-ACCESS.md). LAN: `http://<your-LAN-IP>:3200`.

## Quick start (Docker)

```bash
docker compose up --build
# Portal UI  → http://localhost:3200
# Portal API → http://localhost:3100
# Core       → http://localhost:3000
```

**Demo login:** institution `DEMO` / token `demo-institution-token`

## Quick start (local)

```bash
npm install && npm test
npm run build && PORT=3000 npm start

# separate terminals
CORE_API_URL=http://localhost:3000 PORTAL_PORT=3100 \
  npm --prefix portal/backend install && npm --prefix portal/backend run start:dev

NEXT_PUBLIC_PORTAL_API_URL=http://localhost:3100 \
  npm --prefix portal/frontend install && npm --prefix portal/frontend run dev
```

RocksDB demo journal:

```bash
npm run demo:tokenize -- --dir data/journal-rocks --engine rocksdb
npm run cli -- journal verify --dir data/journal-rocks --engine rocksdb
```

## Architecture (one line)

```
Browser → Portal UI (:3200) → Portal Edge (:3100) → Core Orchestrator (:3000) → NodeChain SoT
```

Portal **never** mints. See [`docs/portal/ARCHITECTURE.md`](docs/portal/ARCHITECTURE.md).

## Hardened path

| Feature | Default |
|---------|---------|
| Journal engine | `rocksdb` (also `file`, `memory`) |
| Signatures | **Ed25519** over contentHash |
| Governance | **L1** → **L2** committee → **L3** policy / LLM panel |
| Kill-switch | engages on chain integrity failure |
| All-Seeing Eye | observe/notify only |
| Keys | `AST_KEY_PROVIDER=memory\|file\|hsm` |

See [`docs/HARDENING.md`](docs/HARDENING.md).

## Layers

See [`docs/STRUCTURE.md`](docs/STRUCTURE.md) and [`docs/layers/`](docs/layers/).  
Code under `src/` (core) and `portal/` (edge only).

## Stack

TypeScript · NestJS core + portal BFF · Next.js portal UI · Jest · Node ≥ 20 · Docker

## License

UNLICENSED — Aros Technology Studio. Contact for commercial use.
