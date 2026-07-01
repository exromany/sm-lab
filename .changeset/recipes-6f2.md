---
'@sm-lab/recipes': minor
---

Add the operator top-up recipes and the cm seed composite. `increaseAllocatedBalance(ctx, { noId,
keyIndex, amountWei })` and `topUpActiveKeys(ctx, { noId })` write `CSModule.allocateDeposits` as the
StakingRouter — single-key and FIFO-over-all-active-keys (2016 ETH cap/key), porting
`NodeOperators.s.sol`. `topUpActiveKeys` reads per-key state up front and writes sequentially in
key-index order (TopUpQueueOps FIFO). `seedCm(ctx, { selector?, seed? })` (`@sm-lab/recipes/cm`)
composes createCuratedOperator/createOperatorGroup/addKeys/deposit/topUpActiveKeys into the
`fork.just seed-cm` scenario, using returned noIds (not hardcoded indices) and deterministic operator
addresses.
