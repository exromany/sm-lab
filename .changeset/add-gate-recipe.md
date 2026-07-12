---
'@sm-lab/merkle': minor
'@sm-lab/recipes': minor
---

Add an `add-gate` recipe + `sm-recipes add-gate` command that *appends* addresses to a gate's
current merkle tree, preserving existing members (unlike `set-gate`, which replaces the whole tree).

- **recipes** `addGateAddrs(ctx, { addresses, selector?, fromCid?, cid? })`: reads the gate's current
  `treeCid`, fetches the pinned dump, unions the new addresses (case-insensitive dedup), and
  delegates build+pin+install to `setGateAddrs`. A no-op guard returns `{ changed: false }` without
  any write when every address is already whitelisted (the gate reverts on an unchanged root).
  Escapes: `--from-cid <cid>` (read the current tree from a known CID) and `--cid <cid>` (skip
  pinning the merged tree). An empty/unset gate tree is treated as an empty set.
- **merkle** exports the IPFS read path: `fetchIpfsJson(cid, opts?)` + `resolveIpfsGatewayUrl()`
  (local-first: the pin origin serves `/ipfs/:cid`; public Pinata gateway fallback), and
  `addressesFromDump(dump)` to recover addresses from a tree dump.
