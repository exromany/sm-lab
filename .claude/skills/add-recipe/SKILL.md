---
name: add-recipe
description: >-
  Scaffold a new sm-recipes command end-to-end in the @sm-lab/recipes CLI — the recipe
  implementation, its RecipeCommand descriptor, and a hermetic test. Use whenever adding,
  wiring, or scaffolding a new recipe / sm-recipes subcommand (a new on-chain SM action in
  the add-keys / operator-info style), even when the user just says "add a recipe for X",
  "new sm-recipes command", "wire up a recipe", or is editing under tools/recipes/src/recipes.
  Follow this so the declarative registry, coercers, positional heuristic, --json contract,
  and connectImpl test seam all stay consistent.
---

# Add a recipe to `@sm-lab/recipes`

`sm-recipes` is a **declarative registry**: every command is a `RecipeCommand` data
descriptor, and one `defineCommand(desc, connectImpl)` factory generates all the commander
wiring (coercion, `connect()` once, `--json` vs human output, error-exit). You add three
things and touch nothing else:

1. **Recipe impl** — `tools/recipes/src/recipes/<name>.ts` — the actual on-chain logic.
2. **Descriptor** — an entry in `tools/recipes/src/cli/commands/{shared,cm,csm}.ts`.
3. **Test** — `tools/recipes/test/<name>.test.ts` — hermetic, via a fake `Ctx`.

Work in this order — impl first (it defines the opts/result types the descriptor reuses),
then descriptor, then test. Run the gates at the end.

## Step 1 — the recipe implementation

A recipe is an `async function` taking `(ctx: Ctx, opts)` and returning typed data. It reads
via `ctx.client`, writes via the `actAs` impersonation engine, and resolves contracts via
`contract(ctx, 'module' | ...)`. Model it on an existing recipe of the same shape:

- **read-only** → copy `src/recipes/operator-info.ts` (returns a typed record; no writes)
- **single write** → copy `src/recipes/deposit.ts`
- **lifecycle pair** (propose/confirm, etc.) → copy `src/recipes/address-changes.ts`

```ts
import type { Hex } from '@sm-lab/receipts';
import { contract, type Ctx } from '../context';

/** One-line description of what on-chain action this performs. */
export async function myRecipe(ctx: Ctx, opts: { noId: bigint }): Promise<{ done: boolean }> {
  const m = contract(ctx, 'module');
  // reads: await ctx.client.readContract({ ...m, functionName, args })
  // writes: go through actAs(ctx, sender, async () => { ... }) — never send from the wrong role
  return { done: true };
}
```

Non-negotiables — these are silent-correctness traps, not style:

- **Units.** On-chain money is **wei** (bigint). ETH CLI input is `parseEther` (1-wei exact).
  cl-mock effective balance is **gwei**. Never `Number()` a wei value; never float-math money.
- **All-bigint.** Keep amounts/ids as `bigint`. If you must `JSON.stringify` anything holding
  a bigint, use the shared `bigintReplacer` (from `../cli/define`) or it throws at runtime.
- **Role gating.** Writes must run as the role the contract requires (StakingRouter, Verifier,
  manager, MetaRegistry-read role, …). Impersonate the correct sender via `actAs`.
- **Determinism.** Roots / CIDs / BLS keys are deterministic — don't introduce `Date`/random.

## Step 2 — the descriptor

Add a `RecipeCommand` object to the right registry array:

- shared across both modules (takes `--module csm|cm`) → `commands/shared.ts` `sharedCommands`
- cm-only → `commands/cm.ts` `cmCommands` (set `module: 'cm'`)
- csm-only → `commands/csm.ts` `csmCommands` (set `module: 'csm'`)

```ts
{
  name: 'my-recipe',
  summary: 'what it does (shown in help)',
  options: [
    operatorId, // reuse shared option objects where they exist
    { flag: '--count <n>', key: 'count', coerce: toNumber, required: true },
    { flag: '--amount <eth>', key: 'amount', coerce: toEth }, // ETH → wei bigint
  ],
  run: (ctx, o: { noId: bigint; count: number; amount?: bigint }) => myRecipe(ctx, o),
  report: (r: { done: boolean }, o) => [`done: ${r.done} for operator ${o.noId}`],
  // module: 'cm',        // ONLY in cm.ts / csm.ts entries
  // needsClMock: true,   // ONLY if the recipe POSTs to the cl-mock (cl-activate does)
}
```

Descriptor rules that bite if ignored:

- **`key` is decoupled from the flag** on purpose. commander treats a `--no-*` long name as a
  boolean negation, so `--operator-id` maps to `key: 'noId'`. Never use a `--no-*` flag; set
  `key` to the recipe's opts property name.
- **Coercers** (from `cli/define.ts`) turn the raw string into the typed value:
  `toBigInt`, `toNumber`, `toEth` (ETH→wei), `toHexValue`, `toAddressValue`, `identity`;
  repeatable: `toPairs` (`noId:bps`), `toAddresses`. Add a new coercer there only if none fit.
- **Positional heuristic.** Required, non-repeatable options are accepted positionally in
  declaration order. To force/forbid, set `positional: true|false`. A repeatable option exposed
  positionally becomes the trailing **variadic** and must be declared last (see `set-gate`).
- **`report(result, opts)` returns `string[]`** — the human-readable lines. With `--json` the
  raw result is printed instead (bigints serialized as strings), so `report` is the _only_
  place you format for humans. Keep it pure; no side effects.
- Shared descriptors are auto-mirrored under the `cm`/`csm` groups with the module pre-bound —
  you get `sm-recipes csm my-recipe` for free. Don't add it twice.

## Step 3 — the hermetic test

Tests never touch the network or a chain. Inject a fake `Ctx` and (for CLI-level tests) pass
a fake `connectImpl` into `buildProgram` / `defineCommand`. Pin exact outputs.

Two levels — write whichever fits (both for a nontrivial recipe):

- **Recipe unit test** — call `myRecipe(fakeCtx, opts)` with a stubbed `ctx.client` and assert
  the decoded result / the exact write args. Copy `test/operator-info.test.ts` or
  `test/deposit.test.ts`.
- **CLI wiring test** — build the program with a fake `connectImpl` and assert parsing,
  coercion, `--json` output, and error-exit. Copy `test/cli-shared.test.ts` / `test/cli-json.test.ts`.

```ts
import { describe, expect, it, vi } from 'vitest';
import { defineCommand } from '../src/cli/define';
// fake connectImpl returns a Ctx whose client is a stub — no RPC.
```

If (and only if) the recipe genuinely needs a live fork, add a smoke test gated exactly like
`test/smoke.fork.test.ts`: `describe.skipIf(!process.env.ANVIL_FORK_URL)`. Never leave an
ungated test that reaches RPC/IPFS/CL.

## Step 4 — verify (per-package gates)

From the repo root, run the fast done-loop for the recipes package:

```bash
pnpm --filter @sm-lab/recipes build
pnpm --filter @sm-lab/recipes types
pnpm --filter @sm-lab/recipes test
pnpm exec oxlint tools/recipes
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```

Then sanity-check the command is wired and self-documents:

```bash
pnpm --filter @sm-lab/recipes exec sm-recipes my-recipe --help
pnpm --filter @sm-lab/recipes exec sm-recipes my-recipe <args> --json   # emits one JSON value
```

Finally, add a changeset (`pnpm changeset`) — a new command is a user-facing change to a
published CLI.

## Gotchas specific to this package

- **Extensionless relative imports.** Write `from './x'`, never `'./x.js'` — the `.js` form
  type-checks but breaks Vitest resolution (a PostToolUse hook flags it).
- **`noUncheckedIndexedAccess` is on.** Guard array access / default your destructures.
- **No DOM lib.** `fetch`/`Response.json()` are `unknown` — type them explicitly.
- Don't extract helpers into `@sm-lab/core` until a _second_ consumer needs them (YAGNI).
