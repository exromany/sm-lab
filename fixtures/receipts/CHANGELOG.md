# @sm-lab/receipts

## 0.3.0

### Minor Changes

- 7ea79c7: Add `@sm-lab/recipes` support for csm02 (CSModule deployed in EIP-7251/0x02 mode as a peer
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

## 0.2.0

### Minor Changes

- 449aa14: Refresh mainnet address books and restructure gate fields.

  - `@sm-lab/receipts`: add `mainnet.cm` (CMv2 curated deployment) and move `mainnet.csm` to v3
    (adds `IdvtcGate`; updates `Ejector` + `PermissionlessGate`).
  - **Breaking:** csm gate fields renamed `VettedGate` → `IcsGate` and
    `IdentifiedDVTClusterGate` → `IdvtcGate`; the unused `GateSeal` field is removed.
  - **Breaking:** cm `CuratedGates: Hex[]` is replaced by flat named fields
    `CuratedGatePO`/`PTO`/`PGO`/`DO`/`EEO`/`IODC`/`IODCP` (matching the lido-csm-sdk gate roles).
  - `@sm-lab/recipes`: `resolveGate` follows the renamed/flattened fields. Gate selectors
    (`ics` / `idvtc` / `po`…`iodcp` / numeric index) and the CLI surface are unchanged.

## 0.1.0

### Minor Changes

- ae31fca: Add optional `IdentifiedDVTClusterGate?: Hex` to `CsmAddressBook` (v3-only gate; present on hoodi,
  absent on mainnet/v2).
- 6e7c8a6: receipts: slim committed address data to a strictly-typed allowlist (drop DeployParams, \*Impl,
  linked libs), and optionally bake LidoLocator-resolved protocol addresses into a `protocol` block
  during `--rpc`-gated refresh (with `manifest.protocolResolvedAt` provenance). recipes `connect()`
  and the keys tool now prefer the baked block and fall back to their previous behavior when absent.

### Patch Changes

- da93973: Add `repository` metadata (git+https://github.com/exromany/sm-lab.git, directory
  `fixtures/receipts`) and reword the description to the repo's Lido SM (Staking Modules)
  scope — the snapshots cover both csm and cm address books.
