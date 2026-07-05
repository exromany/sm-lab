---
'@sm-lab/receipts': minor
'@sm-lab/recipes': minor
---

Refresh mainnet address books and restructure gate fields.

- `@sm-lab/receipts`: add `mainnet.cm` (CMv2 curated deployment) and move `mainnet.csm` to v3
  (adds `IdvtcGate`; updates `Ejector` + `PermissionlessGate`).
- **Breaking:** csm gate fields renamed `VettedGate` → `IcsGate` and
  `IdentifiedDVTClusterGate` → `IdvtcGate`; the unused `GateSeal` field is removed.
- **Breaking:** cm `CuratedGates: Hex[]` is replaced by flat named fields
  `CuratedGatePO`/`PTO`/`PGO`/`DO`/`EEO`/`IODC`/`IODCP` (matching the lido-csm-sdk gate roles).
- `@sm-lab/recipes`: `resolveGate` follows the renamed/flattened fields. Gate selectors
  (`ics` / `idvtc` / `po`…`iodcp` / numeric index) and the CLI surface are unchanged.
