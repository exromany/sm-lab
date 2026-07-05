---
'@sm-lab/recipes': minor
---

`exit-request` now optionally reflects the exit on a running cl-mock: when `ctx.clMockUrl` (or the
CLI `--cl-mock-url` / `CL_MOCK_URL`) is set, the validator is marked `active_exiting` with its
effective balance (32 ETH + allocated), mirroring `clActivate`. Skipped silently when no cl-mock is
configured — the on-chain VEBO submit is unaffected.
