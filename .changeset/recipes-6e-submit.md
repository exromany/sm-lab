---
'@csm-lab/recipes': minor
---

Add `submitRewards(ctx, report)` (increment 6e, PR-2): submit a `RewardsReport` (from `makeRewards`)
on-chain as an oracle report — fund the FeeDistributor when `pendingSharesToDistribute` can't cover
the frame, warp to the next valid consensus frame, build the `IFeeOracle.ReportData` tuple, reach
consensus across the fast-lane members (with a `getMembers` fallback), and submit the report data as
`members[0]`. Returns `{ submitted, refSlot, treeRoot, reportHash, members }`; a zero-root report is a
graceful no-op (`{ submitted: false }`), so `submitRewards(ctx, await makeRewards(ctx))` composes on
an empty fork.

Also adds `warpTo(ctx, timestamp)` — warp fork time to an absolute unix timestamp
(`setNextBlockTimestamp` + `mine`), the absolute counterpart of `warpBy`, used by the consensus-frame
wait. The `reportHash` is `keccak256(abi.encode(data))` over the 9-field struct encoded as one tuple
parameter, with `strikesTreeRoot = keccak256(abi.encode("mock-strikes", refSlot))`.
