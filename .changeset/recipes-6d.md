---
'@csm-lab/recipes': minor
---

Add the cl-mock bridge (increment 6d): `clActivate(ctx, { noId, keyIndex })` reads a key's pubkey
and allocated balance on-chain, then marks it `active_ongoing` on a running `@csm-lab/cl-mock`
(`ctx.clMockUrl`) with effective balance = 32 ETH + allocated balance, in gwei (full precision,
diverging from the source's integer-ETH truncation). Also exports the underlying typed reads
`getPubkey` / `getKeyBalance` and the thin `setClValidator` HTTP client.
