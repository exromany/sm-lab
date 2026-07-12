---
'@sm-lab/ipfs': minor
---

`sm-ipfs` now resolves store-miss CIDs against an upstream gateway **fallback chain** instead of a
single gateway. The default chain is `https://dweb.link` → `https://ipfs.io`, tried in order: the
first 2xx wins, and a miss or failure (404, unreachable, timeout) falls through to the next — so one
flaky public gateway no longer sinks a read.

- `createUpstreamFetcher` accepts `string | string[]`; `createApp({ gateway })` accepts one URL, an
  array, or a comma-separated string.
- `--gateway` and `IPFS_UPSTREAM_GATEWAY` accept a comma-separated list to set a custom chain; a
  single value still replaces the whole chain.
- New `DEFAULT_GATEWAYS` export (the chain); `DEFAULT_GATEWAY` is unchanged (the primary).
- `/admin/status` reports the chain as a comma-joined `gateway` string; the serve banner prints
  `upstream gateways: …` when more than one is configured.
