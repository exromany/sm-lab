# @sm-lab/cl

## 1.1.0

### Minor Changes

- da93973: sm-cl CLI polish: new `completion <shell>` command printing a static bash/zsh/fish
  completion script (`sm-cl completion fish | source`), `--version` wired to the package
  version, and sharper command help — `serve` documents state persistence (`--state`) and
  the upstream cached proxy (`--upstream`), `config set` declares `<status>` as a required
  argument pointing at `sm-cl config statuses`, `query` explains its line-oriented default
  vs the raw `--json` response, `status`/`stop` describe target-URL resolution and failure
  behavior, and the `help` guide now covers `serve --state`/`--upstream`. Packaging fixes:
  `@sm-lab/core` moved to devDependencies — it is bundled into `dist/`, so declaring it as
  a runtime dependency made the published tarball uninstallable — and `repository` metadata
  added for npm provenance.
- 48debc9: feat: enable permissive CORS on the beacon + validator API. The mock backs browser
  consumers (e.g. csm-widget) cross-origin, so it now answers preflight `OPTIONS` and
  returns `Access-Control-Allow-Origin: *` on every route — fetches from a `localhost`
  dev server no longer fail with a CORS error.
- a2b9d20: Migrate the cl-mock service into the sm-lab monorepo as `@sm-lab/cl`. Build moves from
  `tsc` to tsdown (ESM, bundled), entrypoints split into a library export (`.`) and the
  `sm-cl` bin (run via `npx @sm-lab/cl`). Fixes the version lookup path for the bundled output layout; adds the first
  Vitest characterization tests for the Beacon API response shape.

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
