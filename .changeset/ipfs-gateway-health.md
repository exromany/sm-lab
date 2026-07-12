---
'@sm-lab/ipfs': minor
---

`sm-ipfs status` now reports **per-gateway upstream health**, so a persistently-failing gateway in
the fallback chain is observable instead of silently masked by a working fallback.

- The production upstream fetcher tallies every attempt per gateway (hits / misses / timeouts /
  unreachable), exposed via `UpstreamFetcher.snapshot()`. Injected test stubs omit `snapshot`, so
  callers guard with `?.`.
- `/admin/status` gains a `gateways` array (chain order) of
  `{ gateway, attempts, hits, misses, timeouts, unreachable, healthy, note? }`. The existing
  comma-joined `gateway` string is unchanged (back-compat). The field is present only when the
  server's fetcher exposes a snapshot.
- A gateway is `healthy: false` **only** when it was tried yet never once reached (all timeouts /
  unreachable) — a 404 counts as reached, so a content-miss keeps a gateway healthy. Counts are
  in-memory and reset on restart.
- `sm-ipfs status` renders the chain as a ✓ (serving) · — (untested) · ✗ (broken) table with the
  raw counts and a short note. `--json` emits the `gateways` array verbatim.
- New `GatewayHealthEntry` / `GatewayOutcome` exports (from `@sm-lab/ipfs`).
