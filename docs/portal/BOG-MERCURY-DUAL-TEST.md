# Dual business pilot — Bank of Georgia + Mercury

**Status:** Portal two-sided **institution identities** for owner testing  
**Not:** live Bank of Georgia API or Mercury Banking API settlement  
**Canon:** Portal never mints; bank accounts of the company are not NodeChain SoT.

---

## What this test is

| Layer | Meaning |
|-------|---------|
| **AST institution `BOG`** | Your Bank of Georgia **business identity** as an allowlisted portal party (document / process owner or counterparty) |
| **AST institution `MERCURY`** | Your Mercury **business identity** as the second allowlisted party |
| **One `processId`** | Both parties open the **same** tokenization process (invite) |
| **Sandbox fiat evidence** | Optional `POST /v1/sandbox/bank/webhook` — **label** payment refs; not a real wire from BoG/Mercury |

## What this test is **not**

- Logging into BoG or Mercury internet-banking from AST  
- Sharing bank passwords / cards / API secrets in chat  
- Automatic mint when money moves  
- Production bank rails (phase F residual + counsel)

When BoG/Mercury **developer sandboxes** exist, map their webhooks → same evidence schema (`BANK-SANDBOX-F.md`). Until then: dual **portal** parties only.

---

## Bootstrap

```bash
cd /path/to/Aros-Studio-Tokenomics
bash scripts/setup-bog-mercury-pilot.sh --random
# restart edge so secrets load
# then open: data/institution-credentials.txt  (gitignored)
```

| Login id | Display | Role |
|----------|---------|------|
| `BOG` | Bank of Georgia (Business) | institution |
| `MERCURY` | Mercury (Business) | institution |
| `OPS` | AST Operator | operator → `/ops` |

Salts are random when using `--random`. **Never commit** `data/institution-secrets.json`.

---

## Test script (manual)

### Round 1 — BOG owns, Mercury joins

1. Login **BOG** + salt from credentials file.  
2. Tokenization → start process (use real/sample PDF package).  
3. On process page → **Invite counterparty** → `MERCURY`.  
4. Logout → login **MERCURY**.  
5. Cabinet → open **same** `processId`.  
6. Confirm relation `counterparty`, certificate open (read), no create from MERCURY if you only invited (Mercury is also institution role so *can* create own processes — expected).  
7. Optional: bind wallet on owner or holder path.  
8. Login **OPS** → `/ops` → see process under both parties.

### Round 2 — Mercury owns, BOG joins

Same with roles reversed (invite `BOG`).

### Round 3 — Fiat evidence label (sandbox only)

```bash
curl -s -X POST http://127.0.0.1:3100/v1/sandbox/bank/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Sandbox-Secret: sandbox-dev-secret' \
  -d '{
    "processId": "AST-BOG-…",
    "provider": "label-bank-of-georgia",
    "reference": "BOG-TX-REF-OR-MANUAL",
    "status": "settled",
    "amount": "1000.00",
    "currency": "GEL"
  }'
```

Repeat with `"provider": "label-mercury"` and USD if you manually paid via Mercury.  
This **records evidence on the process**; it does **not** talk to the banks.

---

## Acceptance checklist

| # | Check | Pass |
|---|--------|------|
| 1 | Both BOG and MERCURY login work | |
| 2 | Same processId visible to both after invite | |
| 3 | Certificate openable by both | |
| 4 | OPS sees process live on `/ops` | |
| 5 | No portal mint | |
| 6 | Credentials only in password manager / gitignored file | |

---

## Later (real bank rails)

1. Counsel + KYB for each rail.  
2. BoG business API / open banking / file-based confirmation process.  
3. Mercury API sandbox (if available for your entity).  
4. Map `payment.settled` → `fiatEvidence` + human dual-control before Core path.  
5. Never auto-mint on webhook alone (PoT remains gate).

---

**End.**
