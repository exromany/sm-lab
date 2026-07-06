# @sm-lab/receipts

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
