# Framer MCP session notes (AST portal)

**Purpose:** Continuity for agents working portal UI against Framer without losing chat context.

## Status (2026-07-31)

| Item | Value |
|------|--------|
| MCP server | **`proofly-framer`** in `~/.grok/config.toml` |
| Endpoint | `https://mcp.proofly.ae/mcp` (projectId+secret in user config — **do not commit secrets**) |
| Doctor | Healthy — **137 tools**, protocol 2024-11-05 |
| Framer account | `karevadze@icloud.com` · Ketevan's Workspace |
| Project | **Aros Studio Tokenomics** |
| Live read | **OK** via `getProjectXml` (2026-07-31) |

Previous `mcp.unframer.co` URL stayed **plugin not connected**; **proofly** works with this project.

### Pages (from getProjectXml)

| Path | nodeId | Notes |
|------|--------|--------|
| `/` | `RTbM5kfhR` | Focused; hero + about sections, black outer / white content |
| `/about` | `DXsZbYkdp` | |
| `/contact` | `QoAS9fKgb` | |
| `/404` | `O8PmWp3BD` | |
| `/tokenization` | `augiA20Il` | |
| `/nodechain` | `aMKHQlVG3` | |
| `/cabinet` | `yaOR21BXP` | Desktop Wide `CsiKS5Y4e` · Sections `j5QCNztMt` · **AstCabinetPage** instance `Q4Z7qRh1o` (code `CLQYu1s`); design hero `Hcw6cBklQ` hidden |

Home highlights: Top Bar fixed, hero image, H1 style “Proof of Transaction Principle”, Inter fonts, light/dark color styles.

## Tools (proofly Framer MCP)

1. `getProjectXml` — **always first**  
2. `getNodeXml` / `getSelectedNodesXml` / `getNodeHTML` / `getNodeCSS`  
3. `updateXmlForNode` / `deleteNode` / `duplicateNode` / `moveNode`  
4. `exportReactPage` / `exportPageHTML` / `exportReactComponents`  
5. `createCodeFile` / `readCodeFile` / `updateCodeFile`  
6. `createPage` / `addPageBreakpoint` / `zoomIntoView`  
7. Many UI helpers (forms, blog, dark mode, …) — 137 total

## Portal home (already in code)

- Path: `portal/frontend/app/page.tsx` — Canva-style light full-viewport landing  
- Brand: `portal/frontend/public/brand/ast-logo-dark.png` (black on white)  
- Header/footer hidden on `/`  
- Exact EN copy from Canva mock on home  
- Theme: light institutional (globals.css)

## Canva mock (reference)

- Design: `DAHQ6nFCxXs` (view share)  
- Layout: white bg · nav top-right (NodeChain · Solutions · About us · Login) · large `a.` · cyan→blue H1 · centered lead · three soft CTAs  
- MCP Canva: text readable via share URL; export/edit needs owner/edit access  

## Workflow once Framer plugin is open

1. User: Framer → **Cmd+K → MCP** → open plugin on **Aros Studio Tokenomics** project  
2. Agent: call `getProjectXml`  
3. Agent: `getNodeXml` on focused page / home  
4. Align portal Next OR edit Framer via `updateXmlForNode`  
5. Optional: `exportReactComponents` → pull React into `portal/frontend`  

## How agent calls unframer if tools not in session registry

Streamable HTTP JSON-RPC (Accept must include both JSON and SSE):

```bash
URL="https://mcp.unframer.co/mcp?id=…&secret=…"   # from ~/.grok/config.toml
curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getProjectXml","arguments":{}}}'
```

Do **not** put secrets into git. Read URL from user config only.

## User preference (hard)

- Chat in **Russian**; repo docs **English**  
- Do not freestyle design; implement from Canva/Framer  
- Portal is edge only — no mint  
- Continue work **in-session** when possible; this file is fallback memory  
- **No Framer/portal changes without explicit owner permission** (except when owner orders a transfer)  
- **Text / marketing copy** — always agree with owner first; do not rewrite Framer home copy  
- **Editable UI** — see `docs/portal/FRAMER-EDITABLE-UI.md`: native Framer for chrome/titles; code widgets + property controls for text/fonts/show-hide; never full-page opaque login; never wipe hero  

## Cabinet code (`CLQYu1s` AstCabinetPage)

Property panel: all labels, font family/sizes, colors, gap/padding, **Show KPIs / processes / New tokenization / Refresh / Log out / filter / guest bar**.  
Sign-in = modal only. HTTPS uses `PUBLIC_EDGE` (tunnel).  
Page H1 **Cabinet** remains Framer Text above the component.

## Code bridge (2026-07-31) — portal **in Framer UI** (not Next iframe)

Owner ask: *our portal, but in this Framer interface* — so product UI is Framer-native code components calling Portal BFF (`:3100`). No iframe of Next chrome for app pages.

| File | Role | APIs | Framer code id |
|------|------|------|----------------|
| `AstCabinetPage.tsx` | Login + KPIs + process table (B&W, design controls) | `/v1/auth/*`, `/v1/processes*`, `/v1/health/ready` | **`CLQYu1s`** |
| `AstNodeChainPage.tsx` | Full public journal page | `/v1/public/nodechain/*` | **`lqpWJkd`** |
| `AstTokenizationApp.tsx` | Doc hash + sig gate + start (draft) | `/v1/tokenization/start` | not mounted |
| `AstProcessLookup.tsx` | Public process lookup (draft) | `/v1/public/processes/:id` | not mounted |

Placed on pages:

| Framer path | App | Instance |
|-------------|-----|----------|
| `/cabinet` | **AstCabinetPage** | `Q4Z7qRh1o` in Sections `j5QCNztMt` (hero hidden) |
| `/nodechain` | **AstNodeChainPage** | `in0uReds_` in Sections `iHX2maArr` (hero hidden) |
| `/tokenization` | not transferred yet | |
| `/` home | **design only** (copy not rewritten) | |

Session: `localStorage.ast_portal_session` (same key idea as Next).  
Default `apiBase`: `http://localhost:3100`. Run Core + portal edge for live data.  
Marketing/text on home — agree with owner before edits.
