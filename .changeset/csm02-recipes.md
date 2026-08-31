---
'@sm-lab/receipts': minor
'@sm-lab/recipes': minor
---

Add `@sm-lab/recipes` support for csm02 (CSModule deployed in EIP-7251/0x02 mode as a peer
StakingRouter module, hoodi-only).

- New `src/modules.ts` capability table (`NAMED_GATE_MODULES`) replaces binary
  `ctx.module === 'cm'` branching at every gate touch point, so adding a module is a table edit
  going forward.
- csm02 has no named/typed gates (`PermissionlessGate` only): `resolveGate`, `createCsmOperator`,
  `setGateAddrs`'s default selector, `pause`/`resume`, and `getGateTree` all now throw a clear
  error for csm02 instead of silently mis-decoding a `VettedGate`/`CuratedGate` ABI. The
  permissionless (no-selector) `createCsmOperator` path is unaffected.
- New `registerModule` recipe registers csm02's module contract in the StakingRouter (idempotent;
  clones an existing module's `StakingModuleConfig`, defaulting `withdrawalCredentialsType` to 2
  for csm02) — needed since csm02 isn't registered on a fresh fork.
- New `topUpQueue` read recipe reads the CSM 0x02 top-up queue (`enabled`/`limit`/`length`/`head`
  from one snapshot to avoid a straddled-write read; gracefully reports `enabled: false` on an
  upgraded, non-0x02 CSM instead of throwing).
- New `sm-recipes csm02` CLI group: `create-operator` (permissionless-only, no gate options),
  `register-module`, `top-up-queue`, plus every shared recipe mirrored with the module pre-bound.

`@sm-lab/receipts`:

- `ModuleName` gains `'csm02'`, with a `Csm02AddressBook` type (the CSM book minus `IcsGate`/
  `IdvtcGate` — csm02's only entry gate is `PermissionlessGate`) and a committed hoodi snapshot
  (`data/hoodi/csm02.json`, deploy ref `bbdb033d`). Not deployed on mainnet.
- `refresh` accepts `--module csm02`, reading the contracts repo's `artifacts/<chain>/csm0x02/`
  directory via a new `CSM02_SCHEMA`.
- ABIs re-vendored at contracts ref `95062a05`: `StakingRouter` gains `getMaxTopUpPerBlockGwei`
  (additive only; no other ABI changed).
- Cleanup: `deployJsonPath`'s nested ternary is now a `DEPLOY_SUBDIR` lookup map, matching the
  existing `SCHEMA_BY_MODULE` style.
