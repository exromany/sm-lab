---
'@csm-lab/recipes': minor
---

Add `makeRewards(ctx, opts?)` (increment 6e, PR-1): build the cumulative FeeDistributor rewards
tree off on-chain operator state plus a seeded mock reward per active key, pin the tree + report
log to IPFS (guarded; `IPFS_API_URL` or `PINATA_*`, or pass `treeCid`/`logCid` to skip), and
return a typed in-memory `RewardsReport` (`treeRoot`, `treeCid`, `logCid`, `distributed`, `rebate`,
`treeDump`, `cumulatives`).

The per-key draw is fully seeded (keccak hash-chain — no `Math.random`) so `treeRoot`/`distributed`
are reproducible. Carry-forward is via the injectable `opts.previousCumulatives` (Map or entries);
prior leaves carry forward (the `uint64`-max pad excluded) before this frame's deltas. Bigint
report fields are normalized to strings before pinning (the OZ dump and the log both carry bigints).
An empty report (no active keys, no carry-forward) returns a zero root and pins nothing.
