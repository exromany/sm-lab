---
'@sm-lab/merkle': minor
'@sm-lab/recipes': patch
---

Recipes now fail with actionable guidance when a required mock service is down or misconfigured,
instead of a cryptic `fetch failed`.

- **merkle** exports `assertPinnable(skipHint?, opts?)`: before pinning it verifies the target is
  usable — throws credentials guidance when `IPFS_API_URL` points at Pinata without creds, and
  proactively probes reachability for the local/custom endpoint otherwise (any HTTP response counts;
  a thrown fetch means down). Messages tell you how to start the local mock (`npx @sm-lab/ipfs serve`
  / `pnpm stack:up`), set Pinata creds, point `IPFS_API_URL` elsewhere, or skip pinning with a CID.
- **recipes** `set-gate` and `makeRewards` call `assertPinnable` before pinning (fail-before-mutate:
  a missing IPFS backend can never leave a gate with a half-installed tree). `clActivate` /
  `exitRequest` surface a "start the cl-mock (`npx @sm-lab/cl serve`)" message on a connection
  failure, and the unset-`clMockUrl` error now explains how to run and wire it.
