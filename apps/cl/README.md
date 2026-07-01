# @sm-lab/cl

Consensus Layer (Beacon API) mock server for CSM integration testing. Configure validators
over an admin HTTP API; consumers then hit the standard beacon endpoint. State is in-memory —
restart = clean slate.

```bash
npx @sm-lab/cl serve            # binary is sm-cl (unchanged)
sm-cl config set <pubkey> active_ongoing 31.5
sm-cl status
sm-cl query <pubkey>
sm-cl stop
sm-cl help                      # full agent-facing cheat sheet
```

Or in-process (library):

```ts
import { startServer, store } from '@sm-lab/cl';
startServer(5052, '127.0.0.1');
```

## Build

tsdown (ESM, bundled) via the shared `@sm-lab/config` preset. Object entry keeps the source
tree intact and emits two outputs:

- `dist/index.mjs` — library export (`.`)
- `dist/cli.mjs` — the `sm-cl` bin (shebang + exec bit preserved by tsdown)

```ts
// tsdown.config.ts
import { libConfig } from '@sm-lab/config/tsdown';
export default libConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
});
```
