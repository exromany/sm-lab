# `@csm-lab/recipes` CLI — design (increment 6g)

> The deferred "thin CLI" from the anvil-recipes design
> (`2026-06-26-anvil-recipes-design.md`, increment 6g). The full importable recipe surface
> (6a–6f-2) is complete; this adds a command-line front-end over it. A human consumer has
> materialized — distribution target is **published-for-npx**.

## Goal

Expose the recipe surface as a **run-and-exit** CLI that prepares CSM on-chain state on an
anvil fork. This is merkle's shape (fire-and-exit against a fork), **not** cl-mock's shape (a
long-running `serve`/`status`/`stop` server). The CLI is the only layer that **tabulates**
recipe output — the recipes themselves return structured, typed data and never print.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | **Distribution: published-for-npx, via a `bin`** | `@csm-lab/recipes` is published with a `bin`; an external human runs it with zero clone. |
| 2 | **All invocation routes, not npx-only** | The single `bin` field underpins every route — npx, global install, local install, and the built dist. None is privileged. See *Invocation routes* below. |
| 3 | **Surface: full 1:1 with the recipe API (~34 commands)** | Every exported *action recipe* gets a command. "1:1" means the recipe surface — **not** the plumbing (`connect`, `contract`, `makeClient`, `actAs`, `roleMember`, `encode` helpers, role constants), which is a library concern. `setClValidator` is also excluded: raw `cl-set`/`cl-list` stay in cl-mock's own CLI (only `cl-activate` bridges). Kept maintainable by the declarative registry (decision 5), not by trimming the surface. |
| 4 | **Layout: mirror the import subpaths** | Shared recipes top-level (`--module` global); cm-only under a `cm` group, csm-only under a `csm` group — 1:1 with `src/index.ts` // `/cm` // `/csm`. Zero invented taxonomy; trivial to keep in sync. |
| 5 | **Architecture: declarative command registry** | Each command is a *data descriptor*; one factory generates the commander wiring. Adding a recipe = a ~6-line descriptor, not a commander block. The API and CLI cannot drift. |
| 6 | **Output: human default + `--json`** | Pretty/tabulated for the interactive human; `--json` (bigint→string) for csm-lab's own integration-test harnesses to capture fork state. |

## Invocation routes (all reach the same `bin`)

`"bin": { "csm-recipes": "dist/cli.mjs" }` is the mechanism. Every route below is a way to
reach it; the spec requires **all** of them to work, and the smoke/README must cover them:

| Route | Command | Needs |
| --- | --- | --- |
| **npx** | `npx @csm-lab/recipes@latest seed-cm --rpc-url …` | a published release |
| **global install** | `npm i -g @csm-lab/recipes` → `csm-recipes seed-cm …` | the `bin` on `PATH` |
| **local install** | `npm i @csm-lab/recipes` → `npx csm-recipes …` / `pnpm exec csm-recipes …` | local `node_modules/.bin` |
| **built dist (repo dev)** | `node tools/recipes/dist/cli.mjs seed-cm …` / `pnpm --filter @csm-lab/recipes start seed-cm …` | a local build |

Bare-install correctness is the hard constraint: no repo-relative paths in `dist/`;
`readPackageVersion(import.meta.url)` resolves flat-dist `../package.json`; the external
sibling deps (merkle, receipts) resolve from npm (see *Release*).

## Architecture — declarative command registry

Every recipe shares one shape: `fn(ctx, opts) → result`. The CLI command is therefore always
the same pipeline: **coerce flags → build `ctx` via `connect()` → `await fn(ctx, opts)` →
report (human or `--json`)**. That sameness is described as data and the wiring is generated
once.

```ts
// cli/define.ts — the structural core
interface OptionSpec {
  flag: string;            // '--no-id <n>'
  key: string;             // 'noId'
  coerce: (s: string) => unknown;  // toBigInt | toHex | toAddress | identity
  required?: boolean;
}

interface RecipeCommand<O, R> {
  name: string;                            // 'add-keys'
  summary: string;                         // shown in --help
  options: OptionSpec[];
  run: (ctx: Ctx, opts: O) => Promise<R>;  // the recipe, imported from src
  report: (r: R) => string[];              // human lines; --json bypasses this
  module?: 'cm' | 'csm';                   // set ⇒ lives under that group, forces ctx.module
  needsClMock?: boolean;                   // clActivate only
}

// connectImpl is injectable — the seam that keeps tests hermetic.
function defineCommand(desc: RecipeCommand, connectImpl = connect): Command { /* … */ }
```

`defineCommand`'s action: read global `--rpc-url` / `--module` / `--cl-mock-url`, build `ctx`
(once) via `connectImpl`, assemble the coerced typed opts from `desc.options`, `await
desc.run(ctx, opts)`, then branch on `--json`. Wrapped in the `run()` error handler.

## File structure (`src/cli/` dir)

```
src/cli/
  index.ts            #!/usr/bin/env node · dotenv/config · global flags · wire groups · program.parse()
  define.ts           defineCommand factory · OptionSpec · coercers · bigintReplacer · run() error-wrap
  commands/shared.ts  descriptors for the ~27 shared recipes (use the global --module)
  commands/cm.ts      cm descriptors → nested under the `cm` group (ctx.module forced 'cm')
  commands/csm.ts     csm descriptors → nested under the `csm` group (ctx.module forced 'csm')
  help.ts             merkle-style self-contained usage cheat sheet
```

### Command inventory (1:1 with `src/index.ts`)

- **shared** (top-level, `--module csm|cm`): `add-keys`, `operator-info`, `deposit`, `unvet`,
  `exit`, `increase-allocated-balance`, `top-up-active-keys`, `slash`, `withdraw`,
  `report-penalty`, `cancel-penalty`, `settle-penalty`, `compensate-penalty`, `add-bond`,
  `create-bond-debt`, `propose-manager`, `confirm-manager`, `propose-reward`, `confirm-reward`,
  `make-rewards`, `submit-rewards`, `cl-activate` (`needsClMock`), `get-pubkey`,
  `get-key-balance`, `warp` (`--by`), `snapshot`, `revert`. (`warpTo` stays internal.)
- **`cm` group** (module forced `cm`): `seed`, `create-curated-operator`,
  `create-operator-group`, `reset-operator-group`, `set-bond-curve-weight`.
- **`csm` group** (module forced `csm`): `set-gate` (`--selector ics`), `resolve-gate`
  (`--selector idvtc`).

## Global flags & data flow

- `--rpc-url <url>` — defaults to `RPC_URL` (via `dotenv/config`, like merkle). Required;
  explicit throw if neither set.
- `--module <csm|cm>` — for shared commands. The `cm`/`csm` groups ignore it (module implied).
- `--cl-mock-url <url>` — defaults to `CL_MOCK_URL`; only `cl-activate` requires it.
- `--json` — global; emit the raw result instead of human lines.
- IPFS pinning (`make-rewards`, `set-gate`) uses the existing env switch (`IPFS_API_URL` →
  local `@csm-lab/ipfs-mock`, or `PINATA_*`) — unchanged, read by the recipes themselves.

One `connect()` per invocation, from the global flags. `cm`/`csm` groups hardcode
`ctx.module`; shared commands read `--module`.

## Output, errors, coercion

- **Output:** default → `desc.report(result).forEach(l => console.log(l))`; `--json` →
  `console.log(JSON.stringify(result, bigintReplacer, 2))`. `bigintReplacer = (_, v) =>
  typeof v === 'bigint' ? v.toString() : v` — the same single-replacer hazard `makeRewards`
  solved. Kept **local** in `define.ts` (YAGNI; promote to core only on a 2nd consumer).
  Void-returning recipes (`revert`, `unvet`) report a one-line confirmation; `--json` emits
  the result or `{}`.
- **Errors:** merkle's `run(fn)` wrapper verbatim — `catch → console.error('Error:', msg) →
  process.exit(1)`. Reverts throw cleanly via viem. Explicit pre-flight throws: missing
  `--rpc-url`/`RPC_URL`; a `needsClMock` command without `--cl-mock-url`. Commander handles
  missing required flags. The existing `idvtc`/v2-snapshot guard surfaces through the wrapper.
- **Coercion** (per `OptionSpec.coerce`):
  - `toBigInt` (= `BigInt`) for counts/ids/weights: `noId`, `count`, `keyIndex`, `curveId`,
    `weight`, `groupId`.
  - `toEth` (= viem **`parseEther`**) for **every ETH-denominated amount** — the
    `--amount` / `--max-amount` flags of `add-bond`, `create-bond-debt`,
    `increase-allocated-balance`, `report-penalty`, `settle-penalty`, `compensate-penalty`.
    The CLI presents amounts in **ETH**; the coercer converts to the **wei bigint** each recipe
    expects (`amount` / `amountWei` / `maxAmount`). `parseEther` is **string-based decimal →
    bigint — never float math** (`Number(x)*1e18` corrupts small values), so 1 wei round-trips
    exactly: `--amount 0.000000000000000001` → `1n`, `--amount 1` → `10n**18n`. Wei (18
    decimals) is the precision floor; finer input is rounded by `parseEther`.
  - `toHex` (viem `isHex` on `seed`; `cid` passthrough); `toAddress` (viem `isAddress` for the
    propose/confirm address args).
  - Bad input throws → caught by `run()`.

## Testing (hermetic, per CLAUDE.md)

`connectImpl` is the injection seam — no network, no chain:

1. **Pure units** — coercers (happy + throw paths) and `bigintReplacer`, directly. **Must**
   assert the 1-wei boundary: `toEth('0.000000000000000001') === 1n` and `toEth('1') ===
   10n ** 18n` (proves string-based parsing, not float).
2. **Reporters** — each `report` is `result → string[]`, pure; test representative ones with
   canned results.
3. **Factory wiring** — `defineCommand(desc, fakeConnect)` with a stub `run` returning canned
   data; `program.parseAsync(argv, { from: 'user' })`, capture `console.log`, assert: ctx built
   from globals (fakeConnect args), opts coerced correctly, human-vs-`--json` branch. No real
   recipe, no chain.

Recipe *behavior* stays covered by the recipes' existing fake-client tests — the CLI never
re-tests it. Optionally extend the `ANVIL_FORK_URL`-gated smoke to run **one** command
end-to-end (e.g. `add-keys --json`) against a real fork.

## Release machinery (published-for-npx)

1. **recipes package.json:** add `"bin": { "csm-recipes": "dist/cli.mjs" }`, add `commander`
   (catalog) to `dependencies`, add a `start` script (`node dist/cli.mjs`); bump `0.0.0` →
   `0.1.0`.
2. **tsdown:** one line — add `cli: 'src/cli/index.ts'` to the `entry` map. tsdown preserves
   the shebang (merkle proves it). The `alwaysBundle: []` override stays (merkle/receipts
   remain external runtime deps).
3. **Coordinated first publish** — none of `@csm-lab/recipes`, `@csm-lab/merkle`,
   `@csm-lab/receipts` are on npm yet (merkle is `1.1.0` locally but unpublished; recipes
   `0.0.0`; receipts unpublished). recipes' `workspace:*` deps on merkle + receipts mean npx
   needs all three published. Changesets rewrites `workspace:*` → real versions on release.
   Verify a bare install resolves merkle/receipts from npm and runs `csm-recipes` from
   `node_modules/.bin`.
4. **changeset** entry (feat: recipes CLI) + **README** CLI section documenting all four
   invocation routes.

Per-package gates before done, as always: `build · types · test · oxlint <dir> · prettier
--check`.

## Out of scope (YAGNI)

- Sub-wei / >18-decimal amounts — `parseEther` rounds at the 18th decimal; wei is the on-chain
  floor, so there is nothing finer to express.
- A `serve`/daemon mode — recipes are run-and-exit; that is cl-mock's job.
- Interactive prompts / TUI — flags + env only.
- Promoting `bigintReplacer` to `@csm-lab/core` — local until a 2nd consumer needs it.
