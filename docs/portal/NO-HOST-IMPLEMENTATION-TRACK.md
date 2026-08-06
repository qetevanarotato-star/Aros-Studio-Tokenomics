# No-host implementation track

What is implemented **without** permanent VPS/domain (Phase A residual).

| Phase | Local status | Package |
|-------|--------------|---------|
| A | Residual (owner host) | `STABLE-EDGE-A.md` |
| B | **Implemented** (edge + UI) | `TWO-SIDED-PILOT-B.md` |
| C | Residual (QTSP prod); fixtures/D4 remain | `QES-X509-D4.md` · mTLS/OIDC D6 |
| D | **Implemented** (`/ops` + overview API) | `CONTROL-PLANE-SPEC.md` |
| E | Residual (firm engagement) | `EXTERNAL-AUDIT-F1.md` |
| F | **Implemented** (sandbox webhook) | `BANK-SANDBOX-F.md` |
| G | Prior + cert/wallet bind | `WALLET-COMPAT.md` |
| H–J | Residual | `PRODUCT-PHASES-A-J.md` |

Bootstrap two-sided + ops accounts:

```bash
bash scripts/setup-two-sided-pilot.sh
# restart edge so roles load: kill portal backend or home-down/up
bash scripts/home-up.sh   # or restart edge only
```

---

**End.**
