# @csm-lab/cl-mock

Consensus Layer (Beacon API) mock server for CSM integration testing. Configure validators
over an admin HTTP API; consumers then hit the standard beacon endpoint. State is in-memory —
restart = clean slate. The beacon + validator API is **CORS-enabled** (permissive `*`) so
browser consumers (csm-widget / SDK) can call it cross-origin.

```bash
npx @csm-lab/cl-mock serve            # binary is csm-cl-mock (unchanged)
csm-cl-mock config set <pubkey> active_ongoing 31.5
csm-cl-mock status
csm-cl-mock query <pubkey>
csm-cl-mock stop
csm-cl-mock help                      # full agent-facing cheat sheet
```

Or in-process (library):

```ts
import { startServer, store } from '@csm-lab/cl-mock';
startServer(5052, '127.0.0.1');
```

## Build

tsdown (ESM, bundled) via the shared `@csm-lab/config` preset. Object entry keeps the source
tree intact and emits two outputs:

- `dist/index.mjs` — library export (`.`)
- `dist/cli.mjs` — the `csm-cl-mock` bin (shebang + exec bit preserved by tsdown)

```ts
// tsdown.config.ts
import { libConfig } from '@csm-lab/config/tsdown';
export default libConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
});
```

## Migration notes (from `csm-test-cl`)

Migrated verbatim except for changes the new toolchain required:

- **Module resolution** `NodeNext` → `Bundler`: `.js` import extensions stripped (Vite/Vitest
  resolve extensionless; the old `.js`-suffix form would break test imports).
- **Version lookup** `../../package.json` → `../package.json`: tsdown bundles flat into `dist/`,
  so package.json is one level up, not two (the old depth assumed the `dist/server/` layout).
- **Stricter types**: base sets `lib: ["ES2023"]` (no implicit DOM), so `Response.json()` is
  `unknown` not `any` — results are now explicitly typed; one array destructure got a default
  for `noUncheckedIndexedAccess`.
- **buildValidator** exported so the Vitest characterization tests can pin the beacon response.

The binary name `csm-cl-mock` is unchanged; deprecate the old unscoped npm package pointing here.
