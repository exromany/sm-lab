---
'@sm-lab/recipes': minor
---

Add recipes: `set-target-limit`, `remove-key`, `get-curve-info`, and a unified `pause`/`resume`
that targets the module, accounting, or any gate (ics/idvtc for csm; po…iodcp for cm), across both
csm and cm. Exposed as CLI commands (shared, mirrored under the `csm`/`cm` groups).

Also add on-chain `activate-keys` and `report-balance` (Verifier-gated), `topup` (anvil
`setBalance`), and six read-only recipes: `bond-info`, `operator-keys`, `key-balances`,
`operators-count`, `get-last-operator`, and `get-gate-tree`. Exposed as CLI commands (shared,
mirrored under the `csm`/`cm` groups).
