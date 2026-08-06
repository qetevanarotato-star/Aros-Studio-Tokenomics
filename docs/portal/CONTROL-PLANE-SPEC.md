# Phase D — Ops control plane (spec + local implement)

**Goal:** Real-time reflection of edge processes + NodeChain + health — **not** mock KPIs.  
**Role:** `operator` only for aggregate views.  
**Canon:** Observe / operate edge; **no** mint, veto, or journal rewrite from UI.

---

## Screens (v1 local)

| Area | Data source | Control |
|------|-------------|---------|
| Stack health | `GET /v1/health`, `/v1/health/ready` | Read |
| NodeChain | `GET /v1/public/nodechain/status`, `…/nodes?limit=` | Read |
| All edge processes | `GET /v1/ops/overview` | Read |
| Kill-switch / chain.ok | NodeChain status payload | Read |
| Deep links | `/tokenization/:id`, `/nodechain?processId=` | Navigate |
| Metrics (if Core exposes) | ready/health fields | Read |

---

## API

`GET /v1/ops/overview` — session role **operator**

```json
{
  "generatedAt": "ISO",
  "health": {},
  "ready": {},
  "nodechain": {},
  "processes": { "count": 0, "items": [] },
  "note": "Edge aggregate; NodeChain is SoT via Core."
}
```

UI: `/ops` (dashboard shell, operator only; others redirected).

---

## Polling

UI polls every 5s while tab open (same spirit as process status page).  
No fake height — only API values.

---

## Non-goals

- All-Seeing Eye veto  
- Manual mint/burn  
- Editing journal records  

---

## Acceptance

| # | Check |
|---|--------|
| 1 | Login OPS → `/ops` loads |
| 2 | Tip height matches `curl …/nodechain/status` |
| 3 | Process list matches edge store after new tokenization |
| 4 | PILOT login cannot open `/ops` API (403) |

---

**End D card.**
