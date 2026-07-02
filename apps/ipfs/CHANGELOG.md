# @sm-lab/ipfs

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
