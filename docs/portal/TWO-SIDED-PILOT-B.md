# Phase B — Two-sided pilot (no hosting required)

**Goal:** Two live parties on one `processId` path.  
**Depends on:** Local stack (`home-up`) — **not** permanent VPS.  
**Canon:** Portal never mints; NodeChain remains SoT after Core hand-off.

---

## Modes shipped (local pilot)

| Mode | Parties | How |
|------|---------|-----|
| **B1 Institutions** | Issuer + counterparty | Issuer creates process; invites counterparty institution id; counterparty logs in and opens same process |
| **B2 Holder** | Issuer + holder account | Holder role sees processes where `holderId` matches account id (case-insensitive) |
| **B3 Operator** | Ops | Separate role; full edge list + control plane (phase D) |

---

## API

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/v1/processes/:id/invite-counterparty` | Owner institution | body `{ counterpartyInstitutionId }` |
| `GET` | `/v1/processes` | Owner, counterparty, holder (own), operator (all) |
| `GET` | `/v1/processes/:id` | Same visibility |
| `GET` | `/v1/processes/:id/certificate` | Same visibility (read) |
| `POST` | `/v1/processes/:id/bind-wallet` | Owner or holder (not pure counterparty) |

---

## Secrets shape

```json
[
  { "institutionId": "PILOT", "displayName": "Pilot Issuer", "token": "…", "allowlisted": true, "role": "institution" },
  { "institutionId": "COUNTER", "displayName": "Counterparty Registry", "token": "…", "allowlisted": true, "role": "counterparty" },
  { "institutionId": "HOLDER1", "displayName": "Holder Pilot", "token": "…", "allowlisted": true, "role": "holder" },
  { "institutionId": "OPS", "displayName": "AST Operator", "token": "…", "allowlisted": true, "role": "operator" }
]
```

Bootstrap: `bash scripts/setup-two-sided-pilot.sh`

---

## Acceptance (local)

| # | Check |
|---|--------|
| 1 | Login PILOT → start process |
| 2 | Invite COUNTER on process page |
| 3 | Login COUNTER → process visible in cabinet → open status |
| 4 | Login HOLDER1 → sees processes with `holderId=HOLDER1` |
| 5 | Neither party can mint on portal |

---

## Residual (needs host / legal)

- Production QTSP dual-sign workflows  
- Permanent HTTPS for remote second party without tunnel  
- Formal process-type rules for ownership_transfer dual sign  

---

**End B card.**
