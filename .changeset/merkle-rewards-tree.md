---
'@sm-lab/merkle': minor
---

Add `buildRewardsTree(leaves)` + `REWARDS_LEAF_ENCODING` (`['uint256','uint256']`), mirroring
`buildStrikesTree`/`buildIcsTree`. Builds the cumulative FeeDistributor rewards tree — one
`[nodeOperatorId, cumulativeShares]` leaf per operator. Leaf values are `bigint` (not `number`)
because reward shares are wei cumulatives that overflow `Number.MAX_SAFE_INTEGER`. Pure and
deterministic, with a pinned Vitest root, leaf-encoding, proof round-trip, and pad-leaf coverage.
