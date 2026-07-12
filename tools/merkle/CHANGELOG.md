# @sm-lab/merkle

## 1.4.0

### Minor Changes

- e1fe8ea: Add an `add-gate` recipe + `sm-recipes add-gate` command that _appends_ addresses to a gate's
  current merkle tree, preserving existing members (unlike `set-gate`, which replaces the whole tree).

  - **recipes** `addGateAddrs(ctx, { addresses, selector?, fromCid?, cid? })`: reads the gate's current
    `treeCid`, fetches the pinned dump, unions the new addresses (case-insensitive dedup), and
    delegates build+pin+install to `setGateAddrs`. A no-op guard returns `{ changed: false }` without
    any write when every address is already whitelisted (the gate reverts on an unchanged root).
    Escapes: `--from-cid <cid>` (read the current tree from a known CID) and `--cid <cid>` (skip
    pinning the merged tree). An empty/unset gate tree is treated as an empty set.
  - **merkle** exports the IPFS read path: `fetchIpfsJson(cid, opts?)` + `resolveIpfsGatewayUrl()`
    (local-first: the pin origin serves `/ipfs/:cid`; public Pinata gateway fallback), and
    `addressesFromDump(dump)` to recover addresses from a tree dump.

## 1.3.0

### Minor Changes

- ae50802: Recipes now fail with actionable guidance when a required mock service is down or misconfigured,
  instead of a cryptic `fetch failed`.

  - **merkle** exports `assertPinnable(skipHint?, opts?)`: before pinning it verifies the target is
    usable — throws credentials guidance when `IPFS_API_URL` points at Pinata without creds, and
    proactively probes reachability for the local/custom endpoint otherwise (any HTTP response counts;
    a thrown fetch means down). Messages tell you how to start the local mock (`npx @sm-lab/ipfs serve`
    / `pnpm stack:up`), set Pinata creds, point `IPFS_API_URL` elsewhere, or skip pinning with a CID.
  - **recipes** `set-gate` and `makeRewards` call `assertPinnable` before pinning (fail-before-mutate:
    a missing IPFS backend can never leave a gate with a half-installed tree). `clActivate` /
    `exitRequest` surface a "start the cl-mock (`npx @sm-lab/cl serve`)" message on a connection
    failure, and the unset-`clMockUrl` error now explains how to run and wire it.

## 1.2.0

### Minor Changes

- da93973: Rename the ICS tree surface to the module-neutral "addresses (vetted gate) tree" — the same
  `["address"]` tree shape also serves cm CuratedGates, not just CSM's ICS VettedGate. Renamed
  exports: `buildIcsTree` → `buildAddressesTree`, `ICS_LEAF_ENCODING` → `ADDRESSES_LEAF_ENCODING`,
  `makeIcs` → `makeAddresses` (and `CliDeps.makeIcs` → `CliDeps.makeAddresses`); IPFS pin name
  `merkle-tree-ics` → `merkle-tree-addresses`; CLI human report label `ICS` → `Addresses`. The
  `addresses` CLI command name and the `--json` output shape are unchanged, and tree bytes /
  golden roots are identical — a pure rename. Strictly a breaking export rename, shipped as minor
  because the package is still unpublished pre-first-release.

  Also in this release: a `completion <shell>` command printing a static bash|zsh|fish
  completion script (`sm-merkle completion fish | source`), `--version` (read from package.json
  at runtime), `rewards --source` is now a native `.requiredOption` (commander emits the
  missing-option error and marks it required in help), the `strikes <strikes>` argument now
  documents its input schema (`[{ nodeOperatorId, pubkey, strikes: number[] }]`), and
  package.json gained `repository` metadata (`exromany/sm-lab`, directory `tools/merkle`).

- a2b9d20: Migrate `csm-test-tree` into the sm-lab monorepo as `@sm-lab/merkle` (bin `sm-merkle`).
  Build moves from `ts-node`/CommonJS to tsdown (ESM, bundled), split into a library export (`.`)
  and the `sm-merkle` bin.

  Scope is focused on **build + pin**: `ics <addresses>` and `strikes <strikes>` each build a
  `StandardMerkleTree`, pin it to IPFS, and print the root + CID (`--no-upload` for root-only,
  `-o` to also write a `{ treeRoot, treeCid }` handoff file). Pushing root/CID on-chain and
  resolving deploy addresses are intentionally **out of scope** — that work belongs to
  `@sm-lab/receipts` (no `cast`, no `DEPLOY_JSON_PATH`).

  The IPFS endpoint is env-switchable via `IPFS_API_URL` (a thin Pinata-compatible `fetch`
  client, since `@pinata/sdk` v2 hardcodes its host) so it targets `@sm-lab/ipfs` locally
  or real Pinata; a custom endpoint pins without credentials. Adds the first Vitest suite pinning
  the deterministic tree roots, leaf encodings, proofs, parsers, and the IPFS client request shape.

- d1d2d02: Add `buildRewardsTree(leaves)` + `REWARDS_LEAF_ENCODING` (`['uint256','uint256']`), mirroring
  `buildStrikesTree`/`buildAddressesTree`. Builds the cumulative FeeDistributor rewards tree — one
  `[nodeOperatorId, cumulativeShares]` leaf per operator. Leaf values are `bigint` (not `number`)
  because reward shares are wei cumulatives that overflow `Number.MAX_SAFE_INTEGER`. Pure and
  deterministic, with a pinned Vitest root, leaf-encoding, proof round-trip, and pad-leaf coverage.

### Patch Changes

- 5054cb4: chore(deps): security + dependency maintenance.

  - Patch transitive advisories via pnpm overrides: `ws` >=8.21.0 (GHSA-96hv-2xvq-fx4p, high) and `uuid` >=11.1.1 under `@metamask/utils` (GHSA-w5hq-g745-h8pq, moderate).
  - Bump runtime deps: commander 15, dotenv 17, multiformats 14, @hono/node-server 2, @chainsafe/bls 8.
  - Bump dev toolchain: TypeScript 6, Vitest 4, @types/node 26, prettier 3.9.

- 486b033: refactor(cli): extract an injectable `buildProgram(deps)` test seam from the `sm-merkle` CLI.
  The single-file `src/cli.ts` is restructured into `src/cli/` (a `program.ts` that builds the
  program from injected `makeAddresses`/`makeStrikes` implementations + a thin `index.ts` bootstrap that
  loads `.env` and parses), so CLI parsing is now hermetically testable — matching the `sm-keys`
  and `sm-recipes` CLIs. Also de-deprecates the help-command API (`.addHelpCommand(false)` →
  `.helpCommand(false)`), which keeps the built-in help command suppressed so the tool's own custom
  `help` cheat-sheet command stays the only `help`. No user-facing behavior change: the same
  commands, flags, and output as before.
