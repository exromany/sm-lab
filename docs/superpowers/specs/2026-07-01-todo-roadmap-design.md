# TODO Roadmap — `sm-lab`

**Date:** 2026-07-01
**Status:** design (roadmap / meta-spec)
**Type:** sequencing plan across 6 workstreams — each phase spawns its own spec → plan → implementation cycle.

## Context

Five `TODO.md` files (root + `cl-mock`, `ipfs-mock`, `merkle`, `recipes`) accumulated 20 items
during Steps 1–6. This document does **not** implement them; it groups them into workstreams,
sequences the workstreams by dependency, and records the decisions needed to start. It is the
parent of a family of specs — each phase below gets its own design doc when it's picked up.

## Naming decision (settled)

The repo is renamed to reflect what it *is* (a staking test bed), not why it was built (CSM work).
The contracts repo has already been renamed to `staking-modules` on GitHub; the lab is broader than
one module (cl/ipfs mocks aren't module-specific), so the two are a family without being twins.

| Axis | Value |
|---|---|
| repo | `sm-lab` |
| npm scope | `@sm-lab` |
| app packages | `@sm-lab/cl`, `@sm-lab/ipfs` (drop `-mock`) |
| other packages | `@sm-lab/{keys,merkle,recipes,core,config,receipts}` |
| bins | `sm-cl`, `sm-ipfs`, `sm-merkle`, `sm-keys`, `sm-recipes` |

## Workstream inventory

| WS | Name | TODO items covered | Blast radius |
|----|------|--------------------|--------------|
| A | Rename | `csm-lab`→`sm-lab`; drop `-mock` (`npx @sm-lab/cl`) | every package, docker, docs, imports, changesets |
| B | Housekeeping | node 24; deprecated `addHelpCommand`; unique ipfs port; comment cleanup; README migration/CORS cleanup; improve help everywhere; global `.env.sample` | repo-wide, mechanical |
| C | Mock state | cl+ipfs save/load/init state; cl-mock cached proxy to real CL api | `apps/cl`, `apps/ipfs` |
| D | merkle CLI | addresses\|strikes\|**rewards** modes (addresses default); file+positional+`--source` input; ipfs default→local, Pinata on secrets; README `makeIcs` example | `tools/merkle` |
| E | recipes rework | use `@sm-lab/keys` for pubkeys; rework `set-gate`; realign merkle usage (incl. delegate rewards tree/pin to merkle) | `tools/recipes` |
| F | Agentic-first | "how to be agentic-first?" | architectural, cross-cutting |

## Sequencing & dependency graph

```
Phase 1   A  Rename ───────────────────────────────┐  (everything rebases on new names)
                                                    │
Phase 2   B  Housekeeping  +  F1 machine-readable ──┤  (establish the I/O convention here)
             I/O convention                          │
                                                    │
Phase 3   D  merkle CLI  ─────┐                      │  (D & E parallel; E consumes D's new
          E  recipes rework ──┘ (E soft-deps on D)   │   merkle surface + IPFS-default change)
                                                    │
Phase 4   C  Mock state ─────────────────────────────┤  (shared persistence → promote to core)
                                                    │
Phase 5   F2 Agentic-first: MCP server ──────────────┘  (sits on the F1 substrate from Phase 2)
```

**Sequencing rationale — "establish conventions before you propagate them":**
- **A first** so no file is edited twice. Every later phase touches source; renaming after feature
  work means re-touching everything.
- **F1 (machine-readable I/O) folded into B, not deferred.** It's a cross-cutting *convention*
  (universal `--json`, deterministic output, structured errors, documented exit codes), and it's the
  substrate both agentic-first end-states (F2/F3) require. Applied to each tool as Phases 3–4 touch it.
- **D before/with E** because E realigns onto merkle's reworked surface *and* both share the IPFS
  default inversion (see D).
- **F2 (MCP server) last** — it's the genuine "agentic-first" deliverable and needs A–D done and F1
  in place underneath it.

---

## Phase 1 — Rename (WS A)

**Goal:** `csm-lab`/`@csm-lab` → `sm-lab`/`@sm-lab`, apps drop `-mock`, bins become `sm-*`.

**Changes:**
- **Scope codemod:** `@csm-lab/` → `@sm-lab/` across `package.json`, `src/**`, `tsconfig.json`,
  `tsdown.config.ts`, `.env.sample`, docs. (Package `tsconfig` uses *relative* extends, so those
  paths are unaffected — only the string mentions change.)
- **Dir renames:** `apps/cl-mock`→`apps/cl`, `apps/ipfs-mock`→`apps/ipfs`. `tools/*`, `packages/*`,
  `fixtures/*` dirs keep their names (only their scope changes).
- **Package names + bins:** `@sm-lab/cl` (bin `sm-cl`), `@sm-lab/ipfs` (bin `sm-ipfs`),
  `@sm-lab/{merkle,keys,recipes}` (bins `sm-merkle`/`sm-keys`/`sm-recipes`). Update each CLI's
  `.name('csm-…')` string to match its new bin.
- **Docker:** Dockerfile paths (`apps/cl/Dockerfile`), `docker/compose.yaml` build contexts + service
  names, image tags.
- **Pending changesets:** rewrite `@csm-lab/*` package keys in the ~21 `.changeset/*.md` → `@sm-lab/*`.
  **Constraint:** nothing is published to npm yet; the rename must be coordinated with the deferred
  first publish, or the initial release ships under the wrong names.
- **CLAUDE.md + docs:** update all name references.

**Manual step (not automated here):** renaming the git repo directory + GitHub remote is a
human/GitHub action; the spec documents it but does not `mv` the working tree.

**Verification:** after codemod, `grep -r "@csm-lab" --exclude-dir={node_modules,dist,.git}` returns
nothing but intentional historical references; full `pnpm install` + `pnpm turbo run build` green.

---

## Phase 2 — Housekeeping + machine-readable I/O convention (WS B + F1)

**Goal:** clear the mechanical debt and, while touching every CLI, establish the agentic I/O
convention once.

**B changes:**
- **Node 24:** `engines.node` `>=20` → `>=24` in all `package.json`; Docker base `node:20*` →
  `node:24*`; CI workflow node version. (`@types/node` is already `^26`.)
- **Deprecated `addHelpCommand`:** `apps/ipfs/src/cli/index.ts` → `.helpCommand(false)` (copy merkle's
  already-correct pattern).
- **Unique ipfs port:** `apps/ipfs` `DEFAULT_PORT` `3000` → **`5001`** — the real Kubo IPFS API port,
  mirroring cl-mock's deliberate use of `5052` (real beacon port). Kills the `3000` collision.
  Update `docker/compose.yaml`, help text, `IPFS_API_URL` examples.
- **Docs cleanup:** drop migration sections + CORS notes from READMEs; **delete `docs/migration.md`**
  (migration complete). CORS stays in code.
- **Global `.env.sample`:** the root `.env.sample` today only covers `@sm-lab/receipts` refresh.
  Expand it to a single grouped file documenting *every* env var across all packages (per-package
  headers, resolution order, and which are test-only). Concrete inventory:

  | Package | Vars | Notes |
  |---|---|---|
  | receipts (refresh) | `<CHAIN>_RPC_URL` (`HOODI_RPC_URL`, `MAINNET_RPC_URL`, …), `ETH_RPC_URL` | resolution `--rpc` > `<CHAIN>_RPC_URL` > `ETH_RPC_URL` |
  | recipes | `RPC_URL` (anvil default), `CL_MOCK_URL`, `IPFS_API_URL` + Pinata (shared w/ merkle), `ANVIL_FORK_URL` | `ANVIL_FORK_URL` gates the smoke test only |
  | merkle | `IPFS_API_URL`, `PINATA_API_KEY`, `PINATA_API_SECRET`, `PINATA_JWT` | Pinata used only when set (see 3a inversion) |
  | cl-mock | `CL_MOCK_URL` (client target), upstream CL URL for the Phase-4 proxy | |
  | ipfs-mock | `IPFS_MOCK_URL`, `IPFS_UPSTREAM_GATEWAY` | |

  **Sub-decision (forced by the rename):** rename `*_MOCK_URL` → `*_URL` alongside the `-mock` drop,
  or keep the `MOCK` marker since the services are still mocks? Env-var names are a public contract and
  nothing is published yet — cheapest to decide now. Recorded here; settled in Phase 1's spec.
- **Comment cleanup:** remove redundant/obvious comments only. Preserve load-bearing "why" comments —
  the toolchain gotchas in CLAUDE.md are hard-won and stay.
- **Help polish:** consistent cheat sheet + examples + `--json` documented across all 5 CLIs.

**F1 changes (machine-readable I/O convention — applied here, propagated in Phases 3–4):**
- Universal `--json` on every command that emits data (recipes/keys/merkle already partial; make it total).
- Deterministic output ordering; stable field names.
- Structured errors: on failure emit a JSON error object (to stderr) under `--json`, plain text otherwise.
- Documented, stable exit codes.
- Record the convention in CLAUDE.md so future commands inherit it.

---

## Phase 3 — Tools (WS D + E, parallel)

### 3a — merkle CLI (WS D)

**Current reality:** `ics <addresses-file>` and `strikes <strikes-file>` subcommands already exist;
input is a *required file path*; `IPFS_API_URL` unset → **real Pinata**.

**Changes:**
- **Modes/naming:** `ics` → `addresses` (the default mode); keep `strikes`; **add `rewards`**. Bare
  invocation defaults to `addresses`.
- **Rewards mode (consolidated from recipes):** merkle already owns `buildRewardsTree`
  (`[nodeOperatorId, cumulativeShares]` leaves). The `rewards` mode owns the *full* input→tree→pin
  pipeline that `recipes/rewards.ts` inlines today — build the tree dump, build the report `log`,
  `toJsonSafe` bigint→string coercion, and pin both (`rewards-tree` + `rewards-log`) via
  `pinJsonToIpfs`. Input is the cumulative dataset as raw JSON (parallel to how `addresses`/`strikes`
  take theirs). Prints root + treeCid + logCid.
- **Input flexibility:** accept inline positionals (`sm-merkle addresses 0x01 0x02 0x03`), `--input
  0x01`, or `--source addresses.json` (file). File and inline forms unify into one input list.
- **IPFS default inversion:** unset → **local ipfs-mock** (`http://127.0.0.1:5001`); switch to Pinata
  only when `PINATA_*` secrets are present. This changes `ipfsOptionsFromEnv`/`shouldAttemptPin`
  defaults — **note: recipes shares these**, so E inherits the new behavior (see 3b).
- **README:** TS API example using `makeIcs`.

### 3b — recipes rework (WS E) — soft-depends on 3a

**Current reality:** `tools/recipes/src/keys.ts` fabricates pubkeys/signatures via keccak (48-byte
pubkey / 96-byte sig). `@sm-lab/keys` already exports `makeDepositKeys`.

**Changes:**
- **Real keys:** replace the keccak fake-pubkey generator with `@sm-lab/keys` `makeDepositKeys` for
  BLS pubkeys in `addKeys`.
- **Rework `set-gate`** (`cli/commands/csm.ts`): improve ergonomics of the selector + variadic address
  handling.
- **Realign merkle usage** (`csm/`, `cm/`) onto 3a's reworked surface + the new IPFS default.
- **Delegate rewards tree/pin to merkle:** `makeRewards` in `recipes/rewards.ts` keeps only the
  chain-aware half — read operators, draw seeded per-key rewards, produce cumulative `[noId, shares]`
  leaves + the report-log payload — then hands them to merkle's `rewards` pipeline for tree-build +
  pinning. Removes the inlined `buildRewardsTree` + `toJsonSafe` + dual `pinJsonToIpfs` from recipes.

---

## Phase 4 — Mock state (WS C)

**Goal:** make both mocks stateful across restarts and seedable at boot.

**Changes:**
- **save/load state:** persist the in-memory store to disk (path via flag/env); reload on start.
- **`init` / start-with-state:** boot from a provided state file.
- **cl-mock cached proxy:** when a real CL API URL is configured, proxy-and-cache upstream responses;
  fall back to mock data when absent.
- **core promotion:** save/load logic is identical across cl + ipfs → this clears the YAGNI bar (a
  second consumer exists) and is promoted to `@sm-lab/core`.

---

## Phase 5 — Agentic-first (WS F)

You chose *machine-readable I/O* + *explore*. This decomposes into a committed layer and an open
end-state:

- **F1 — machine-readable I/O (committed):** delivered in Phase 2, propagated through 3–4. Everything
  an agent runs is parseable, deterministic, with structured errors and stable exit codes.

- **F2 vs F3 — the end-state (open, decided in this phase's own spec):**
  - **F2 — MCP server (`@sm-lab/mcp`)** *(recommended):* expose recipes / merkle / mock-control as
    native MCP tools with JSON schemas. An agent (e.g. Claude) drives them as first-class tools — no
    shelling out, no output parsing. Highest ceiling for actual agent use. Depends on F1's structured
    surface. Medium-high effort.
  - **F3 — unified `sm-lab` CLI:** one binary aggregating all tools as subcommands with
    `--help --json` schema introspection an agent can discover. Simpler; agents still shell out and
    parse. Medium effort. Alternative to F2, not additive.

The F2/F3 choice is deliberately deferred to Phase 5's spec — it's the least-understood phase and
shouldn't be over-committed now.

---

## Cross-cutting decisions (settled)

- Repo/scope/bins: `sm-lab` / `@sm-lab` / `sm-*` (see Naming).
- ipfs-mock default port → `5001`.
- Delete `docs/migration.md` in Phase 2.
- F1 (machine-readable I/O) is early + cross-cutting, not a deferred phase.
- IPFS default inverts (local-first, Pinata-on-secrets) in Phase 3a and propagates to recipes.

## Open questions (resolved in later specs, not now)

- Phase 5: F2 (MCP) vs F3 (unified CLI).
- Phase 1/2: rename `*_MOCK_URL` env vars → `*_URL` alongside the `-mock` drop, or keep `MOCK`?
- Phase 3a: exact `strikes` leaf schema stays as-is unless the input-flexibility rework requires touching it.
- Phase 3a/b: merkle's rewards pipeline name — recipes already exports `makeRewards`, so merkle's
  needs a distinct name (e.g. `makeRewardsTree`); and whether the report-`log` shape lives in merkle
  (with the pipeline) or stays a recipes-supplied payload. Decided in 3a's spec.
- Phase 4: on-disk state format (JSON snapshot vs append log) and proxy cache policy.

## Non-goals / YAGNI

- No new modules or recipes beyond wiring existing ones.
- No publishing in this roadmap — the coordinated first npm publish remains a separate deferred action
  (Phase 1 only makes the names correct for it).
- No speculative core extraction beyond the mock-state promotion in Phase 4.

## Next step

Each phase becomes its own spec → plan → implementation cycle. **Phase 1 (Rename)** is the entry point
and the natural first `writing-plans` target once this roadmap is approved.
