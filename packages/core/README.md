# @csm-lab/core

Shared internals consumed by the service packages (`apps/cl-mock`, `apps/ipfs-mock`).
Private — **bundled into** each consumer's artifact via tsdown's `deps.alwaysBundle`
(see `packages/config/tsdown.base.ts`), so it never ships as its own npm package and
consumers get no transitive `@csm-lab/*` to resolve at runtime.

## Contents

Harvested from the duplication that the cl-mock and ipfs-mock migrations exposed — nothing
speculative.

| Module | Exports | What it does |
| --- | --- | --- |
| `server.ts` | `startServer(app, { port, host, onListen })` | Boot a Hono app on Node; build the shutdown closure, register it for `/admin/shutdown`, bind SIGINT/SIGTERM. |
| `admin.ts` | `registerAdminRoutes(app, { version, getStatus })`, `setShutdownHandler`, `readPackageVersion(metaUrl)` | Shared `GET /admin/status` (common envelope + app-specific `getStatus()` extras) and `POST /admin/shutdown`. `readPackageVersion` reads the consumer's version — pass `import.meta.url`. |
| `cli.ts` | `createStatusCommand`, `createStopCommand`, `resolveUrl`, `findRoot`, `formatUptime` | Commander factories for the `status`/`stop` client commands (parameterized by `{ envVar, defaultPort }`; `status` takes a `render` callback for app-specific lines) and the URL/uptime helpers. |

## Usage

```ts
import { startServer, registerAdminRoutes, readPackageVersion } from '@csm-lab/core';

registerAdminRoutes(app, {
  version: readPackageVersion(import.meta.url),
  getStatus: () => ({ pins: { total: store.size } }), // app-specific status fields
});
startServer(app, { port, host, onListen: (url) => console.log(`listening on ${url}`) });
```

## Deliberately NOT here

- **Domain validators** (cl-mock's `isValidPubkey`, ipfs-mock's `isLikelyCid`) — different
  domains, not the same helper; they stay in their packages.
- **merkle's `cast` wrapper / env loader** — only one consumer today. Extract if/when a
  second package needs it (YAGNI), not before.
