---
'@sm-lab/merkle': minor
'@sm-lab/recipes': patch
---

Fix `add-gate` on a gate with an empty allowlist. An empty gate carries a **placeholder** `treeCid`
(e.g. `"someCid"`), not a real pinned CID — `addGateAddrs` previously tried to fetch it and failed
with a cryptic `GET /ipfs/someCid 400`. It now recognizes a non-CID `treeCid` as "no current tree"
and treats it as an empty set (installs just the new addresses), exactly like a fresh gate.

- **merkle** exports `isLikelyCid(value)` (the same `CID.parse` check the `@sm-lab/ipfs` gateway
  uses), so callers can tell a real pinned tree from an unset/placeholder one before fetching. A
  real allowlist is always pinned under a valid CID; a valid-but-unreachable CID still throws (now
  with an actionable message that includes the caller's skip hint), so a real allowlist is never
  silently dropped.
- **recipes** `addGateAddrs` gates the IPFS fetch on `isLikelyCid(treeCid)`.
