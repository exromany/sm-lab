# @sm-lab/ipfs

## 1.3.0

### Minor Changes

- 524eb5b: `sm-ipfs status` now reports **per-gateway upstream health**, so a persistently-failing gateway in
  the fallback chain is observable instead of silently masked by a working fallback.

  - The production upstream fetcher tallies every attempt per gateway (hits / misses / timeouts /
    unreachable), exposed via `UpstreamFetcher.snapshot()`. Injected test stubs omit `snapshot`, so
    callers guard with `?.`.
  - `/admin/status` gains a `gateways` array (chain order) of
    `{ gateway, attempts, hits, misses, timeouts, unreachable, healthy, note? }`. The existing
    comma-joined `gateway` string is unchanged (back-compat). The field is present only when the
    server's fetcher exposes a snapshot.
  - A gateway is `healthy: false` **only** when it was tried yet never once reached (all timeouts /
    unreachable) — a 404 counts as reached, so a content-miss keeps a gateway healthy. Counts are
    in-memory and reset on restart.
  - `sm-ipfs status` renders the chain as a ✓ (serving) · — (untested) · ✗ (broken) table with the
    raw counts and a short note. `--json` emits the `gateways` array verbatim.
  - New `GatewayHealthEntry` / `GatewayOutcome` exports (from `@sm-lab/ipfs`).

## 1.2.0

### Minor Changes

- d0c7c36: `sm-ipfs` now resolves store-miss CIDs against an upstream gateway **fallback chain** instead of a
  single gateway. The default chain is `https://dweb.link` → `https://ipfs.io`, tried in order: the
  first 2xx wins, and a miss or failure (404, unreachable, timeout) falls through to the next — so one
  flaky public gateway no longer sinks a read.

  - `createUpstreamFetcher` accepts `string | string[]`; `createApp({ gateway })` accepts one URL, an
    array, or a comma-separated string.
  - `--gateway` and `IPFS_UPSTREAM_GATEWAY` accept a comma-separated list to set a custom chain; a
    single value still replaces the whole chain.
  - New `DEFAULT_GATEWAYS` export (the chain); `DEFAULT_GATEWAY` is unchanged (the primary).
  - `/admin/status` reports the chain as a comma-joined `gateway` string; the serve banner prints
    `upstream gateways: …` when more than one is configured.

### Patch Changes

- d0c7c36: `sm-ipfs serve` now prints a `fetch a CID: <url>/ipfs/<cid>` hint in its startup banner, so the
  gateway read path is discoverable without opening `sm-ipfs help`.

## 1.1.0

### Minor Changes

- da93973: sm-ipfs CLI polish: new `completion <shell>` command printing a static bash/zsh/fish
  completion script (`sm-ipfs completion fish | source`), `--version` wired to the package
  version, tailored `status`/`stop` help descriptions (target URL resolution + failure
  behavior), and the `help` guide now documents `serve --state` and distinguishes
  `--persist` (per-pin directory mirror) from `--state` (single JSON snapshot). The README's
  "State & persistence" section now documents `serve --state` (load-on-boot / save-on-shutdown
  snapshot + `/admin/save` / `/admin/load` bound to the configured path) alongside `--persist`.
  Packaging fixes: `@sm-lab/core` moved to devDependencies — it is bundled into `dist/`, so it
  was never a real runtime dependency — `repository` metadata added for npm provenance, and the
  stale `csm` keyword replaced with `staking-modules` (repo re-scoped to Lido SM).
- 4ad131b: feat: enable permissive CORS on the pinning API + `/ipfs/:cid` gateway. The mock backs
  browser consumers (e.g. csm-widget) cross-origin, so it now answers preflight `OPTIONS`
  and returns `Access-Control-Allow-Origin: *` on every route — fetches from a `localhost`
  dev server no longer fail with a CORS error.
- a2b9d20: Add `@sm-lab/ipfs` (`sm-ipfs` bin): a Pinata-compatible IPFS pinning + gateway
  emulator for Lido SM testing. Implements `POST /pinning/pinJSONToIPFS`, `POST /pinning/pinFileToIPFS`,
  `GET /data/pinList`, and `DELETE /pinning/unpin/:cid` with deterministic CIDs (CIDv1 / raw codec
  0x55 / sha2-256). The `GET /ipfs/:cid` gateway serves locally-pinned content and transparently
  proxies store-miss CIDs to a real upstream gateway (default `https://dweb.link`, overridable via
  `IPFS_UPSTREAM_GATEWAY` or `serve --gateway`), caching proxied results. Same Hono + commander shape
  as `cl-mock` (`serve`/`status`/`stop`/`help`, in-memory store with optional `--persist <dir>`,
  graceful shutdown). The app factory is injectable (`createApp({ store, fetchUpstream })`) so tests
  run hermetically with no network.

### Patch Changes

- a2b9d20: Extract shared server internals into `@sm-lab/core` (bundled into each consumer, not
  published): the Hono `startServer` scaffold + graceful shutdown, the `/admin/status` +
  `/admin/shutdown` routes and runtime version read, and the `status`/`stop` CLI command
  factories plus the URL/uptime helpers. cl-mock and ipfs-mock now consume core; their
  published binaries, HTTP surface, and behavior are unchanged.
- 5054cb4: chore(deps): security + dependency maintenance.

  - Patch transitive advisories via pnpm overrides: `ws` >=8.21.0 (GHSA-96hv-2xvq-fx4p, high) and `uuid` >=11.1.1 under `@metamask/utils` (GHSA-w5hq-g745-h8pq, moderate).
  - Bump runtime deps: commander 15, dotenv 17, multiformats 14, @hono/node-server 2, @chainsafe/bls 8.
  - Bump dev toolchain: TypeScript 6, Vitest 4, @types/node 26, prettier 3.9.
