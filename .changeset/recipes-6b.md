---
'@sm-lab/recipes': minor
---

Add `@sm-lab/recipes` (anvil recipes MVP, increment 6b): `connect` (LidoLocator-resolved
context) + the `actAs` impersonation engine, plus `addKeys`, `operatorInfo`,
`warpBy`/`snapshot`/`revert`, `cm` `createCuratedOperator`, and `csm` `setGateAddrs` (ics).
TypeScript API only; reuses `@sm-lab/receipts` (ABIs/addresses) and `@sm-lab/merkle`
(tree building). No Foundry.
