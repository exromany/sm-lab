# @csm-lab/receipts

The canonical, versioned home for CSM deploy receipts. Replaces the loose `deploy.json`
files copied between repos and the `DEPLOY_JSON_PATH` env dance.

```ts
import { receipts } from '@csm-lab/receipts';
const csm = receipts.holesky.CSModule.address; // typed, autocompleted, compile-checked
```

## Status: migrate snapshots out of the contracts repo

Source of truth = **committed snapshots** (decided in ADR-0001), not generated on the fly.

- `data/<scenario>/deploy.json` — curated snapshot per network/scenario (e.g. `holesky`,
  `mainnet`, `devnet-local`). Extracted from the contracts repo's Foundry `broadcast/` output.
- `src/index.ts` — imports the JSON and re-exports it **typed**, so consumers get
  autocomplete and break at compile time if an address moves.
- `scripts/refresh.ts` — reads a contracts checkout (path via flag/env), pulls the
  relevant addresses from `broadcast/*/run-latest.json`, rewrites the snapshots. Run by a
  human when a deployment changes; output is committed. No Solidity toolchain lives here.

```ts
import { libConfig } from '@csm-lab/config/tsdown';
export default libConfig();
```
