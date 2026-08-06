# Phase A — Stable edge (owner card)

**Goal:** Permanent HTTPS URL for the institutional portal. Login without Cloudflare quick tunnels. Production flags: `AST_ALLOW_DEMO=0`, real institution secrets.

**Status:** Engineering package exists (`docker-compose.prod.yml`, cutover scripts). **Live host + DNS = owner action.**  
**Canon:** Portal is edge only — never mints. Journal remains SoT.

**Related:** [`GO-LIVE-F1.md`](../GO-LIVE-F1.md) · [`cutover/E1-DOMAIN.md`](../cutover/E1-DOMAIN.md) · [`cutover/E2-SECRETS.md`](../cutover/E2-SECRETS.md) · [`PRODUCTION-READINESS-D11.md`](../PRODUCTION-READINESS-D11.md) · [`INSTITUTION-SECRETS.md`](INSTITUTION-SECRETS.md)

---

## 1. Done when (acceptance)

| # | Check | Evidence |
|---|--------|----------|
| 1 | Public HTTPS hostname opens portal UI | Browser `https://<host>/login` |
| 2 | Login works with **real** institution id + token | No DEMO / no `pilot` default unless you intentionally keep a pilot institution in secrets |
| 3 | `AST_ALLOW_DEMO=0` on edge | Edge env / compose |
| 4 | API reachable without mixed-content / random tunnel URL | Same host or documented edge URL; Framer `portalBase` points at permanent origin |
| 5 | Health green | `npm run cutover:health -- --base https://<host>` (or path that hits UI + edge) |
| 6 | Certificate QR uses public origin (not `localhost`) | `AST_PUBLIC_HOST` / `AST_PUBLIC_PORTAL_ORIGIN` / browser origin |
| 7 | Secrets not in git | `.env.production` + `data/institution-secrets.json` gitignored |

**Out of scope for A:** second institution (phase B), bank rails, NFT-in-wallet, full operator control plane.

---

## 2. Recommended path (Namecheap + VPS)

You keep DNS at **Namecheap**. App runs on a **VPS** (not home Mac). TLS on the VPS (Caddy or nginx + Let's Encrypt).

```
Internet → https://portal.yourdomain.com  (A record → VPS public IP)
                ports 80/443
                      │
                      ▼
              reverse proxy (TLS)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       UI :3200   edge :3100   core :3000
          (docker compose prod; UI may same-origin proxy /v1)
```

### Why this path

| Alternative | Use when |
|-------------|----------|
| **VPS + Namecheap (recommended for A)** | Permanent demo / pilot for partners |
| Home Mac + ports 80/443 + Caddy | Only if stable white IP + router forward · [`DOMAIN-HOME.md`](../DOMAIN-HOME.md) |
| Cloudflare **named** tunnel | Domain on Cloudflare; no open ports · not required if you refuse Cloudflare |
| `home-tunnel.sh` quick URL | **Not** phase A — temporary only |

---

## 3. Owner prerequisites (you provide)

1. **Domain** at Namecheap (or any registrar you control).  
2. **VPS** with public IP, Ubuntu 22.04+ recommended, open **22** (SSH), **80**, **443**.  
3. **SSH access** as a user who can run Docker.  
4. **Email** for Let's Encrypt (e.g. `admin@yourdomain.com`).  
5. Decision: hostname, e.g. `portal.yourdomain.com` or apex `@`.

Nothing in this phase requires Cloudflare.

---

## 4. Step-by-step

### 4.1 Secrets (laptop or VPS — once)

```bash
cd /path/to/Aros-Studio-Tokenomics

# Real institution (replace id/name)
bash scripts/setup-institution-secrets.sh \
  --id YOURBANK \
  --name "Your Institution Name" \
  --random-salt

# Optional second institution later (phase B)
# bash scripts/setup-institution-secrets.sh --id PARTNER --name "Partner" --random-salt

# Materialize production env (gitignored)
export AST_PUBLIC_HOST=portal.yourdomain.com   # no https://
npm run cutover:env

# Must pass before public deploy
npm run cutover:preflight
# Optional strict host:
# bash scripts/cutover-preflight.sh --require-public-host
```

| Output | Path | Commit? |
|--------|------|---------|
| Secrets JSON | `data/institution-secrets.json` | **No** |
| Human creds (once) | `data/institution-credentials.txt` | **No** — store in password manager |
| Prod env | `.env.production` | **No** |

Login will use **Institution id + Token** from credentials file — not chat-shared `pilot`.

Rotate if leaked: `bash scripts/rotate-institution-secrets.sh --all` then re-run `cutover:env`.

### 4.2 DNS (Namecheap)

| Type | Host | Value |
|------|------|--------|
| A | `portal` (or `@`) | **VPS public IPv4** |
| AAAA | optional | VPS IPv6 if used |

Wait until `dig +short portal.yourdomain.com` returns the VPS IP.

### 4.3 VPS bootstrap

```bash
# On VPS (example)
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker "$USER"   # re-login after
```

Clone or rsync the repo (prefer private clone + tag `v1.2.0` or your release).

Copy secrets **securely** (scp, not chat):

```bash
# From laptop
scp .env.production user@VPS_IP:~/Aros-Studio-Tokenomics/.env.production
# Or rebuild secrets only on VPS with setup-institution-secrets + cutover:env
```

Review `.env.production` on VPS:

| Variable | Production value |
|----------|------------------|
| `NODE_ENV` | `production` |
| `AST_ALLOW_DEMO` | `0` |
| `AST_REQUIRE_INSTITUTION_AUTH` | `1` |
| `AST_INSTITUTION_SECRETS_JSON` | real array from cutover:env |
| `AST_INSTITUTION_TOKEN` | non-placeholder |
| `AST_PUBLIC_HOST` | `portal.yourdomain.com` |
| `NEXT_PUBLIC_PORTAL_API_URL` | Prefer **empty** if UI same-origin proxies `/v1`; else `https://portal.yourdomain.com` or edge public URL |

`docker-compose.prod.yml` already sets portal-edge `AST_ALLOW_DEMO: "0"`.

### 4.4 Run stack

```bash
cd ~/Aros-Studio-Tokenomics
npm run cutover:preflight
docker compose -f docker-compose.prod.yml --env-file .env.production up --build -d
```

Services: **core** :3000, **portal-edge** :3100, **portal-ui** :3200 (published as configured).

Do **not** expose Core :3000 to the public internet without a firewall rule. Prefer:

- public only **80/443** on reverse proxy → UI (and same-origin `/v1` → edge);
- edge/core bound to localhost or Docker network only if proxy terminates on host.

### 4.5 TLS reverse proxy (Caddy example)

Install Caddy on VPS. Example Caddyfile (adjust upstream ports if not published on host):

```caddy
portal.yourdomain.com {
  encode gzip
  # UI
  reverse_proxy /v1/* 127.0.0.1:3100
  reverse_proxy /* 127.0.0.1:3200
}
```

Or nginx: `location /v1/` → edge, `location /` → UI, certbot for HTTPS.

Set on edge (if certificate absolute URLs needed):

```bash
# optional in edge env / compose override
AST_PUBLIC_PORTAL_ORIGIN=https://portal.yourdomain.com
```

### 4.6 Verify

```bash
# From laptop
curl -sS https://portal.yourdomain.com/v1/health
curl -sS https://portal.yourdomain.com/v1/public/info
npm run cutover:health -- --base https://portal.yourdomain.com

# Browser
# https://portal.yourdomain.com/login
# Institution + token from data/institution-credentials.txt (password manager)
```

Framer / external embed: set permanent `portalBase` / public edge to `https://portal.yourdomain.com` (not `*.trycloudflare.com`).

### 4.7 Stop temporary tunnels

When A is live:

- stop `home-tunnel.sh` / `framer-api-tunnel.sh` for demos;
- do not put tunnel URLs in Framer or investor decks.

---

## 5. Checklist (print / tick)

| # | Step | Owner |
|---|------|-------|
| 1 | Domain + VPS IP ready | You |
| 2 | `setup-institution-secrets` + `cutover:env` | You / agent on laptop |
| 3 | `cutover:preflight` PASS | You / agent |
| 4 | Namecheap A record | You |
| 5 | Docker prod up on VPS | You |
| 6 | TLS proxy 80/443 | You |
| 7 | Login HTTPS works | You |
| 8 | Health + process smoke | You |
| 9 | Credentials in password manager; never git | You |
| 10 | Framer portalBase → permanent host | You |

Chat optional when live: **`A stable edge live`** + hostname (no tokens).

---

## 6. What agent can do in-repo (no VPS access)

- Generate secrets + `.env.production` on your machine  
- Run preflight locally  
- Fix compose / env example bugs  
- Document Framer base URL update  

**Cannot:** register DNS, buy VPS, open firewall, obtain Let's Encrypt on your host without credentials.

---

## 7. Failure modes

| Symptom | Fix |
|---------|-----|
| Login 401 / no institutions | `AST_ALLOW_DEMO=0` and empty secrets — run setup + cutover:env |
| Mixed content in Framer | HTTPS only; no `http://` API from HTTPS page |
| Tunnel URL changed | Expected for quick tunnels — finish phase A |
| QR points to localhost | Set `AST_PUBLIC_HOST` / public origin |
| Preflight fails `change-me` | Replace placeholders in `.env.production` |
| Port 80 busy on home path | Free 80/443 or use VPS |

---

## 8. Next after A

Full ladder **A–J** (acceptance + non-goals): [`../PRODUCT-PHASES-A-J.md`](../PRODUCT-PHASES-A-J.md)

| Phase | Focus |
|-------|--------|
| **B** | Two-sided pilot (second institution / holder role) |
| **C** | Prod X.509 / mTLS-OIDC trust |
| **D** | Operator control plane (live process + NodeChain) |
| **E…J** | Audit → bank sandbox → representation → multi-node → field → BFT |

---

**End of Phase A card.**
