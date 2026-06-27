---
'@csm-lab/recipes': minor
---

Add `@csm-lab/recipes` (anvil recipes MVP, increment 6b): `connect` (LidoLocator-resolved
context) + the `actAs` impersonation engine, plus `addKeys`, `operatorInfo`,
`warpBy`/`snapshot`/`revert`, `cm` `createCuratedOperator`, and `csm` `setGateAddrs` (ics).
TypeScript API only; reuses `@csm-lab/receipts` (ABIs/addresses) and `@csm-lab/merkle`
(tree building). No Foundry.
