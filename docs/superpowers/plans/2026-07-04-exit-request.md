# exit-request Recipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the deferred `exit-request` recipe into `@sm-lab/recipes` — submit a single validator-exit request to the Validators Exit Bus Oracle (VEBO) by impersonating its consensus contract + a `SUBMIT_DATA_ROLE` holder.

**Architecture:** One new recipe file `exit-request.ts` exposing `exitRequest(ctx, opts)`. It reads the key pubkey (shared module ABI), discovers the module id from the StakingRouter, packs a 64-byte exit request, fakes VEBO consensus by impersonating `getConsensusContract()` → `submitConsensusReport`, then impersonates the VEBO admin (reused as the submitter) → `grantRole(SUBMIT_DATA_ROLE) + submitReportData`. A declarative CLI descriptor is added to the shared registry and auto-mirrored under `csm`/`cm`. Zero `@sm-lab/receipts` changes — `ctx.addresses.vebo`, `vEBOAbi`, `stakingRouterAbi`, `getSigningKeys`, `actAs`/`roleMember` all already ship.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), viem, vitest (hermetic fake `RecipeClient`), commander CLI, tsdown build.

**Spec:** `docs/superpowers/specs/2026-07-04-exit-request-design.md`

## Global Constraints

- **ESM extensionless imports** — write `from './x'`, NOT `'./x.js'`. Use `import type` for type-only imports.
- **`noUncheckedIndexedAccess` is on** — guard/`!`-assert array indexing (e.g. `ids[idx]!` after an `idx !== -1` check).
- **No DOM lib** — not relevant here, but do not add DOM types.
- **`--json` contract** — data-emitting commands print one 2-space-indent JSON value (bigints as strings via `bigintReplacer`); errors → stderr `Error: …`, exit 1. Handled by the `defineCommand` factory; the recipe just returns a plain object.
- **Prettier:** single quotes, width 100, trailing commas. **oxlint** clean. Prefer `Array#toSorted()` over `.sort()`.
- **`reportHash = keccak256(abi.encode(report))` MUST encode the 5-field struct as ONE tuple param** — never flatten into 5 top-level params (drops the tuple offset, changes the hash). Mirrors `rewards.ts:REPORT_DATA_PARAMS`.
- **Recipe is module-agnostic** — `contract(ctx, 'module')` selects CSModule/CuratedModule by `ctx.module`; the module-id scan matches that same address. No csm/cm branching in the recipe.
- **Per-package done-check (run from repo root):** `pnpm --filter @sm-lab/recipes build` · `types` · `test` · `pnpm exec oxlint tools/recipes` · `pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"`.
- **Faithful-port divergences (deliberate, documented in code comments):** (1) reuse the VEBO admin as the `submitReportData` submitter instead of the source's fresh granted address — identical on-chain effect, one fewer impersonation, `grantRole` is idempotent; (2) the module-id scan iterates **all** staking-module ids, fixing the source's `for (i=len-1; i>0; i--)` loop that skips index 0.

---

## Existing patterns to mirror (read before starting)

- **Write recipe shape:** `tools/recipes/src/recipes/penalties.ts` — `contract(ctx,'module')`, `roleMember(ctx, target, ROLE)`, `actAs(ctx, who, (from) => ctx.client.writeContract({ ...target, functionName, args, account: from, chain: null }))`.
- **reportHash tuple-param trap:** `tools/recipes/src/recipes/rewards.ts` — `REPORT_DATA_PARAMS = parseAbiParameters('(...)')`, `keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [data]))`.
- **Test helpers:** `tools/recipes/test/helpers/fake-client.ts` (`makeFakeClient({ reads: { fnName: value | (args)=>value } })`, `fc.byMethod('readContract'|'writeContract'|'impersonateAccount')`, `fc.order()`) and `tools/recipes/test/helpers/book.ts` (`A(n)`, `fakeCtx('csm'|'cm', client, bookOverrides)`; PROTOCOL sets `vebo: A(0xf2)`, `stakingRouter: A(0xf1)`).
- **Test assertion style:** `tools/recipes/test/validators.test.ts` — `const w = fc.byMethod('writeContract')[0] as any; expect(w.functionName)…; expect(w.args)…; expect(w.account)…`.
- **CLI descriptor shape:** `tools/recipes/src/cli/commands/shared.ts` (`set-target-limit`, `remove-key`); the shared `operatorId` / `keyIndex` option objects (top of file); `toBigInt` from `../define`.
- **Fake client returns per output arity:** single `bytes`/`address`/`bytes32`/`uint256` output → the value directly; a function with **multiple** outputs (e.g. `getConsensusReport`) → an **array** `[hash, refSlot, deadline, started]`; a single **struct** output (e.g. `getStakingModule`) → an **object** keyed by field names (`.stakingModuleAddress`).

---

## Task 1: `exitRequest` recipe + hermetic tests + index export + gated smoke

**Files:**
- Create: `tools/recipes/src/recipes/exit-request.ts`
- Create: `tools/recipes/test/exit-request.test.ts`
- Modify: `tools/recipes/src/index.ts` (add exports)
- Modify: `tools/recipes/test/smoke.fork.test.ts` (add one gated round-trip)

**Interfaces:**
- Consumes: `contract(ctx, 'module')` → `{ address: Hex; abi: typeof csModuleAbi }`; `actAs(ctx, who: Hex, fn)`; `roleMember(ctx, { address, abi }, role) → Promise<Hex>`; `DEFAULT_ADMIN_ROLE` (from `../roles`); `vEBOAbi`, `stakingRouterAbi`, `Hex` (from `@sm-lab/receipts`); `ctx.addresses.vebo`, `ctx.addresses.stakingRouter` (on `ResolvedAddresses`).
- Produces (Task 2 consumes these):
  ```ts
  export interface ExitRequestOptions { noId: bigint; keyIndex: bigint; validatorIndex?: bigint }
  export interface ExitRequestResult {
    noId: bigint; keyIndex: bigint; validatorIndex: bigint;
    moduleId: bigint; refSlot: bigint; reportHash: Hex; pubkey: Hex;
  }
  export function exitRequest(ctx: Ctx, opts: ExitRequestOptions): Promise<ExitRequestResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tools/recipes/test/exit-request.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { exitRequest } from '../src/recipes/exit-request';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

// A 48-byte BLS pubkey (0xab * 48) and the known packed data / hash for the vector below.
const PUBKEY = `0x${'ab'.repeat(48)}` as const;
// moduleId=3, noId=7, validatorIndex=900000 (0xdbba0):
//   bytes3(3)                = 000003
//   bytes5(7)                = 0000000007
//   bytes8(900000)           = 00000000000dbba0
//   pubkey (48 bytes)        = ab*48
const EXPECTED_DATA = `0x0000030000000007${'00000000000dbba0'}${'ab'.repeat(48)}` as const;

const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, uint256 requestsCount, uint256 dataFormat, bytes data)',
);

/** Base fake-client reads for a csm module registered at staking-module id 3, VEBO state fixed. */
function reads(moduleAddr = A(0x01)) {
  return {
    getSigningKeys: PUBKEY,
    getStakingModuleIds: [1n, 2n, 3n],
    getStakingModule: (args: any) =>
      args[0] === 3n ? { stakingModuleAddress: moduleAddr } : { stakingModuleAddress: A(0x99) },
    getConsensusReport: ['0x' + '00'.repeat(32), 5n, 0n, false], // refSlot = 5 → report refSlot = 6
    getConsensusVersion: 2n,
    getContractVersion: 4n,
    getConsensusContract: A(0xcc),
    SUBMIT_DATA_ROLE: ('0x' + '11'.repeat(32)) as `0x${string}`,
    getRoleMember: A(0xad), // VEBO DEFAULT_ADMIN_ROLE member 0 (via roleMember)
  };
}

describe('exitRequest', () => {
  it('packs the 64-byte request and submits consensus + report data', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n, validatorIndex: 900000n });

    // packed data (asserted via the submitReportData write below); result echoes inputs + discovered ids.
    expect(res.moduleId).toBe(3n);
    expect(res.refSlot).toBe(6n);
    expect(res.pubkey).toBe(PUBKEY);
    expect(res.validatorIndex).toBe(900000n);

    const writes = fc.byMethod('writeContract') as any[];
    // 1) submitConsensusReport as the consensus contract
    expect(writes[0].functionName).toBe('submitConsensusReport');
    expect(writes[0].account).toBe(A(0xcc));
    const [hashArg, refSlotArg, deadlineArg] = writes[0].args;
    expect(refSlotArg).toBe(6n);
    expect(deadlineArg).toBe(1_700_000_000n + 86400n); // block.timestamp + 1 day
    // 2) grantRole then 3) submitReportData, both as the admin
    expect(writes[1].functionName).toBe('grantRole');
    expect(writes[1].args).toEqual([reads().SUBMIT_DATA_ROLE, A(0xad)]);
    expect(writes[1].account).toBe(A(0xad));
    expect(writes[2].functionName).toBe('submitReportData');
    expect(writes[2].account).toBe(A(0xad));
    const [report, contractVersion] = writes[2].args;
    expect(contractVersion).toBe(4n);
    expect(report).toEqual({
      consensusVersion: 2n,
      refSlot: 6n,
      requestsCount: 1n,
      dataFormat: 1n,
      data: EXPECTED_DATA,
    });

    // reportHash: independently tuple-encoded (guards the flatten trap) — must match both writes.
    const expectedHash = keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [report]));
    expect(res.reportHash).toBe(expectedHash);
    expect(hashArg).toBe(expectedHash);
  });

  it('impersonates the consensus contract then the admin, in that order', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(fc.byMethod('impersonateAccount')).toEqual([{ address: A(0xcc) }, { address: A(0xad) }]);
  });

  it('defaults validatorIndex to 900000n', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(res.validatorIndex).toBe(900000n);
    const submit = (fc.byMethod('writeContract') as any[])[2];
    expect(submit.args[0].data).toBe(EXPECTED_DATA);
  });

  it('resolves the module id by scanning all staking-module ids (index 0 included)', async () => {
    const fc = makeFakeClient({
      reads: {
        ...reads(),
        getStakingModuleIds: [5n], // single id at index 0 — source would skip it and revert
        getStakingModule: (args: any) =>
          args[0] === 5n ? { stakingModuleAddress: A(0x01) } : { stakingModuleAddress: A(0x99) },
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await exitRequest(ctx, { noId: 0n, keyIndex: 0n });
    expect(res.moduleId).toBe(5n);
  });

  it('throws when the module is not registered in the StakingRouter', async () => {
    const fc = makeFakeClient({
      reads: { ...reads(), getStakingModule: () => ({ stakingModuleAddress: A(0x99) }) },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(exitRequest(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/not registered/);
  });

  it('cm: reads getSigningKeys / matches module id on the CuratedModule address', async () => {
    const fc = makeFakeClient({ reads: reads(A(0x21)) }); // cm CuratedModule = A(0x21)
    const ctx = fakeCtx('cm', fc.client, { CuratedModule: A(0x21) });
    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(res.moduleId).toBe(3n);
    // getSigningKeys was read on the CuratedModule address
    const sk = (fc.byMethod('readContract') as any[]).find((r) => r.functionName === 'getSigningKeys');
    expect(sk.address).toBe(A(0x21));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sm-lab/recipes test -- exit-request`
Expected: FAIL — `Cannot find module '../src/recipes/exit-request'` (file does not exist yet).

- [ ] **Step 3: Implement the recipe**

Create `tools/recipes/src/recipes/exit-request.ts`:

```ts
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  numberToHex,
  parseAbiParameters,
} from 'viem';
import { stakingRouterAbi, vEBOAbi, type Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, type Ctx } from '../context';
import { DEFAULT_ADMIN_ROLE } from '../roles';

export interface ExitRequestOptions {
  noId: bigint;
  keyIndex: bigint;
  /** CL validator index packed into the report. Defaults to 900000n (matches the just recipe). */
  validatorIndex?: bigint;
}

export interface ExitRequestResult {
  noId: bigint;
  keyIndex: bigint;
  validatorIndex: bigint;
  /** module id discovered in the StakingRouter. */
  moduleId: bigint;
  /** the report ref slot (= last consensus report refSlot + 1). */
  refSlot: bigint;
  /** keccak256(abi.encode(report)) submitted to VEBO. */
  reportHash: Hex;
  /** the 48-byte BLS pubkey exited. */
  pubkey: Hex;
}

/** DATA_FORMAT_LIST — the single supported VEBO exit-request data format. */
const DATA_FORMAT = 1n;
/** processing deadline offset — `block.timestamp + 1 days` (matches the source). */
const ONE_DAY = 86_400n;

/**
 * The VEBO `ReportData` struct as ONE tuple parameter (components in declaration order, verified
 * against `fixtures/receipts/src/abi/VEBO.ts`). `abi.encode(report)` for a single struct ==
 * ABI-encoding one tuple parameter — do NOT flatten into 5 top-level params (that drops the tuple
 * offset and changes the hash). Same trap `rewards.ts` documents for the fee-oracle report.
 */
const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, uint256 requestsCount, uint256 dataFormat, bytes data)',
);

/**
 * Request a single validator exit via the Validators Exit Bus Oracle. Port of
 * `NodeOperators.s.sol:_exitRequest`. Reads the key pubkey + discovers the module id, packs the
 * 64-byte exit request, then fakes VEBO consensus by impersonating the consensus contract
 * (`submitConsensusReport`) and submits the data as the VEBO admin (`grantRole` + `submitReportData`).
 *
 * Module-agnostic: `contract(ctx,'module')` picks CSModule/CuratedModule by `ctx.module`, and the
 * module-id scan matches that same address — no csm/cm branching.
 *
 * Deliberate divergences from the source (identical on-chain effect):
 * - reuses the VEBO admin as the `submitReportData` submitter (source grants a fresh address);
 *   `grantRole` is idempotent so re-granting the admin never reverts.
 * - scans ALL staking-module ids (source's `for (i=len-1; i>0; i--)` skips index 0).
 */
export async function exitRequest(ctx: Ctx, opts: ExitRequestOptions): Promise<ExitRequestResult> {
  const validatorIndex = opts.validatorIndex ?? 900_000n;
  const m = contract(ctx, 'module');
  const vebo = { address: ctx.addresses.vebo, abi: vEBOAbi } as const;

  // 1. key pubkey (48 bytes) + module id (scan the StakingRouter for this module's address)
  const pubkey = (await ctx.client.readContract({
    ...m,
    functionName: 'getSigningKeys',
    args: [opts.noId, opts.keyIndex, 1n],
  })) as Hex;
  const moduleId = await resolveModuleId(ctx, m.address);

  // 2. pack the single exit request: bytes3 moduleId | bytes5 noId | bytes8 validatorIndex | pubkey
  const data = encodePacked(
    ['bytes3', 'bytes5', 'bytes8', 'bytes'],
    [
      numberToHex(moduleId, { size: 3 }),
      numberToHex(opts.noId, { size: 5 }),
      numberToHex(validatorIndex, { size: 8 }),
      pubkey,
    ],
  );

  // 3. build the report (refSlot = last consensus report refSlot + 1) + its hash
  const consensusReport = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusReport',
  })) as readonly [Hex, bigint, bigint, boolean];
  const refSlot = consensusReport[1] + 1n;
  const consensusVersion = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusVersion',
  })) as bigint;
  const report = {
    consensusVersion,
    refSlot,
    requestsCount: 1n,
    dataFormat: DATA_FORMAT,
    data,
  };
  const reportHash = keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [report]));

  // 4. fake consensus: impersonate the consensus contract and submit the report hash directly
  const consensus = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusContract',
  })) as Hex;
  const deadline = (await ctx.client.getBlock()).timestamp + ONE_DAY;
  await actAs(ctx, consensus, (from) =>
    ctx.client.writeContract({
      ...vebo,
      functionName: 'submitConsensusReport',
      args: [reportHash, refSlot, deadline],
      account: from,
      chain: null,
    }),
  );

  // 5. submit the report data as the VEBO admin (granting itself SUBMIT_DATA_ROLE first)
  const admin = await roleMember(ctx, vebo, DEFAULT_ADMIN_ROLE);
  const submitRole = (await ctx.client.readContract({
    ...vebo,
    functionName: 'SUBMIT_DATA_ROLE',
  })) as Hex;
  const contractVersion = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getContractVersion',
  })) as bigint;
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...vebo,
      functionName: 'grantRole',
      args: [submitRole, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...vebo,
      functionName: 'submitReportData',
      args: [report, contractVersion],
      account: from,
      chain: null,
    });
  });

  return {
    noId: opts.noId,
    keyIndex: opts.keyIndex,
    validatorIndex,
    moduleId,
    refSlot,
    reportHash,
    pubkey,
  };
}

/** Find the staking-module id whose registered address is `moduleAddress` (scans ALL ids). */
async function resolveModuleId(ctx: Ctx, moduleAddress: Hex): Promise<bigint> {
  const sr = { address: ctx.addresses.stakingRouter, abi: stakingRouterAbi } as const;
  const ids = (await ctx.client.readContract({
    ...sr,
    functionName: 'getStakingModuleIds',
  })) as bigint[];
  const mods = (await Promise.all(
    ids.map((id) =>
      ctx.client.readContract({ ...sr, functionName: 'getStakingModule', args: [id] }),
    ),
  )) as { stakingModuleAddress: Hex }[];
  const idx = mods.findIndex(
    (mod) => mod.stakingModuleAddress.toLowerCase() === moduleAddress.toLowerCase(),
  );
  if (idx === -1)
    throw new Error(`@sm-lab/recipes: module ${moduleAddress} not registered in the StakingRouter`);
  return ids[idx]!;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sm-lab/recipes test -- exit-request`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Add index exports**

In `tools/recipes/src/index.ts`, after the `pause` export block at the end, add:

```ts
export { exitRequest } from './recipes/exit-request';
export type { ExitRequestOptions, ExitRequestResult } from './recipes/exit-request';
```

- [ ] **Step 6: Add the gated fork smoke**

In `tools/recipes/test/smoke.fork.test.ts`: add `exitRequest` to the imports from `'../src/recipes/exit-request'`, then add this `it` block inside the `describe.skipIf(!FORK_URL)` block (after the pause/resume test):

```ts
  it('requests a validator exit via VEBO for operator 0 key 0', async () => {
    const ctx = await connect({ module: 'csm', rpcUrl: FORK_URL as string });
    const res = await exitRequest(ctx, { noId: 0n, keyIndex: 0n });
    expect(res.pubkey).toMatch(/^0x[0-9a-fA-F]{96}$/); // 48-byte BLS pubkey
    expect(typeof res.moduleId).toBe('bigint');
    expect(res.refSlot).toBeGreaterThan(0n);
    expect(res.reportHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
```

Add the import near the other recipe imports at the top of the file:

```ts
import { exitRequest } from '../src/recipes/exit-request';
```

- [ ] **Step 7: Run the package gate**

Run (from repo root):
```bash
pnpm --filter @sm-lab/recipes build && \
pnpm --filter @sm-lab/recipes types && \
pnpm --filter @sm-lab/recipes test && \
pnpm exec oxlint tools/recipes && \
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```
Expected: build OK; types OK; all tests pass (smoke suite skipped — no `ANVIL_FORK_URL`); oxlint clean; prettier clean.

- [ ] **Step 8: Commit**

```bash
git add tools/recipes/src/recipes/exit-request.ts tools/recipes/src/index.ts \
        tools/recipes/test/exit-request.test.ts tools/recipes/test/smoke.fork.test.ts
git commit -m "feat(recipes): exitRequest — VEBO validator-exit report recipe"
```

---

## Task 2: `exit-request` CLI command + name-list test + changeset

**Files:**
- Modify: `tools/recipes/src/cli/commands/shared.ts` (import + one descriptor)
- Modify: `tools/recipes/test/cli-shared.test.ts` (add `'exit-request'` to the expected name list)
- Create: `.changeset/exit-request.md`

**Interfaces:**
- Consumes: `exitRequest`, `ExitRequestOptions`, `ExitRequestResult` from `../../recipes/exit-request` (Task 1); shared `operatorId` / `keyIndex` option objects and `toBigInt` (already in `shared.ts` / `../define`).
- Produces: a `RecipeCommand` named `exit-request` in `sharedCommands`, auto-mirrored under `csm`/`cm` by `program.ts`.

- [ ] **Step 1: Update the command-name test (RED)**

In `tools/recipes/test/cli-shared.test.ts`, add `'exit-request'` to the array passed to `expect(names).toEqual([...].toSorted())` — insert it alphabetically (after `'deposit'`, before `'get-curve-info'`):

```ts
        'deposit',
        'exit',
        'exit-request',
        'get-curve-info',
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test -- cli-shared`
Expected: FAIL — the received names array is missing `'exit-request'` (assertion diff shows it absent).

- [ ] **Step 3: Add the CLI descriptor**

In `tools/recipes/src/cli/commands/shared.ts`:

First, add the import (next to the other recipe imports, e.g. after the `pause` import):

```ts
import { exitRequest } from '../../recipes/exit-request';
```

Then add this descriptor object to the `sharedCommands` array (place it after the `exit` command's descriptor to keep related commands together):

```ts
  {
    name: 'exit-request',
    summary: 'request a validator exit via VEBO (impersonates the consensus contract + a submitter)',
    options: [
      operatorId,
      keyIndex,
      {
        flag: '--validator-index <n>',
        key: 'validatorIndex',
        coerce: toBigInt,
        description: 'CL validator index to pack into the report (default 900000)',
      },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; validatorIndex?: bigint }) =>
      exitRequest(ctx, o),
    report: (
      r: { moduleId: bigint; refSlot: bigint; reportHash: string },
      o: { noId: bigint; keyIndex: bigint },
    ) => [
      `operator ${o.noId} key ${o.keyIndex}: exit requested (module ${r.moduleId}, refSlot ${r.refSlot})`,
      `reportHash ${r.reportHash}`,
    ],
  },
```

(`operatorId` and `keyIndex` are `required`, so `define.ts`'s positional heuristic accepts them as `exit-request <noId> <keyIndex>`; `--validator-index` is optional → flag-only.)

- [ ] **Step 4: Run the CLI tests to verify they pass**

Run: `pnpm --filter @sm-lab/recipes test -- cli`
Expected: PASS — `cli-shared` name list matches; the `cli-program` mirror test (if present) still passes because the shared command is auto-mirrored under `csm`/`cm`. Also confirms the `every option has a coerce fn and a non-negation flag` assertion holds (all three options use `toBigInt`, no `--no-*` flags).

- [ ] **Step 5: Add the changeset**

Create `.changeset/exit-request.md`:

```markdown
---
'@sm-lab/recipes': minor
---

Add the `exit-request` recipe + CLI command: submit a single validator-exit request to the
Validators Exit Bus Oracle (VEBO) by impersonating its consensus contract and a `SUBMIT_DATA_ROLE`
holder. Module-agnostic (csm + cm); auto-mirrored under the `csm`/`cm` CLI groups.
`sm-recipes exit-request <operator-id> <key-index> [--validator-index n]`.
```

- [ ] **Step 6: Run the package gate**

Run (from repo root):
```bash
pnpm --filter @sm-lab/recipes build && \
pnpm --filter @sm-lab/recipes types && \
pnpm --filter @sm-lab/recipes test && \
pnpm exec oxlint tools/recipes && \
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```
Expected: all green (smoke suite skipped without `ANVIL_FORK_URL`).

- [ ] **Step 7: Commit**

```bash
git add tools/recipes/src/cli/commands/shared.ts tools/recipes/test/cli-shared.test.ts \
        .changeset/exit-request.md
git commit -m "feat(recipes): exit-request CLI command + changeset"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Signature / options / return (`ExitRequestOptions`/`ExitRequestResult`) → Task 1 interfaces + Step 3. ✅
- On-chain sequence (pubkey → moduleId → pack → refSlot → report → hash → consensus submit → admin grant+submit) → Task 1 Step 3, asserted in Step 1. ✅
- Hash trap (one tuple param) → `REPORT_DATA_PARAMS` in Step 3; independently re-encoded in the test. ✅
- Submitter divergence (reuse admin) + moduleId all-ids divergence → coded + commented in Step 3; index-0 + not-registered tests in Step 1. ✅
- Default `validatorIndex = 900000n` → Step 3 + test. ✅
- Module switch (csm/cm) → Step 3 (no branching) + cm test in Step 1. ✅
- CLI descriptor + positional heuristic + auto-mirror → Task 2. ✅
- Zero receipts changes → no receipts files touched. ✅
- Gated smoke → Task 1 Step 6. ✅
- Changeset (`@sm-lab/recipes: minor`) → Task 2 Step 5. ✅
- CL-mock reflection is explicitly out of scope in the spec → no task, correct. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete code. ✅

**3. Type consistency:** `ExitRequestOptions`/`ExitRequestResult` field names + types match across Task 1 (definition, recipe return, tests) and Task 2 (descriptor `run`/`report` signatures). `refSlot`/`moduleId`/`reportHash`/`pubkey` consistent. `getConsensusReport` typed as a 4-tuple; `getStakingModule` as `{ stakingModuleAddress }`. `numberToHex` sizes (3/5/8) match the `bytes3/5/8` packed types. ✅
