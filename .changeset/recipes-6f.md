---
'@csm-lab/recipes': minor
---

Add increment 6f: csm `idvtc` gate selector (`resolveGate(ctx, 'idvtc')` →
`IdentifiedDVTClusterGate`, v3-only/hoodi; throws on snapshots lacking it, e.g. mainnet/v2) and cm
group/curve recipes (`createOperatorGroup`, `resetOperatorGroup`, `setBondCurveWeight`, ported from
`MetaRegistryHelpers.s.sol`, exported via `@csm-lab/recipes/cm`). `seedCm` + `topUpActiveKeys`
deferred to 6f-2.
