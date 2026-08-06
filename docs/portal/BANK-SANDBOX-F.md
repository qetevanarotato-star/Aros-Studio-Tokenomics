# Phase F — Bank/PSP sandbox (local, no hosting)

**Goal:** Fiat **evidence** webhooks attach to a process without claiming custody or auto-mint.  
**Canon:** Payment evidence ≠ PoT; mint only after Core PoT.

---

## Local sandbox API

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/v1/sandbox/bank/webhook` | `X-Sandbox-Secret` env `AST_BANK_SANDBOX_SECRET` (default local: `sandbox-dev-secret`) **or** operator session |

Body:

```json
{
  "processId": "AST-…",
  "reference": "PAY-123",
  "status": "settled",
  "amount": "1000.00",
  "currency": "USD",
  "provider": "sandbox-bank"
}
```

Effect: appends to edge process `fiatEvidence[]`; visible on process status / ops. **Does not** mint.

---

## Acceptance

| # | Check |
|---|--------|
| 1 | Webhook with secret → 200 + evidence on process |
| 2 | Bad secret → 401 |
| 3 | Unknown process → 404 |
| 4 | Core mint path unchanged |

---

## Residual

Real bank/PSP KYB, production secrets, dual-control, counsel.

---

**End F local card.**
