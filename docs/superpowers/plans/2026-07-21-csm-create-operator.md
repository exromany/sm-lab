# `csm create-operator` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `createCsmOperator` recipe + `sm-recipes csm create-operator` CLI command that creates a CSM node operator through the PermissionlessGate (default) or a vetted gate (`ics`/`idvtc`, with allowlist + merkle proof), submitting keys and ETH bond at creation.

**Architecture:** One new recipe (`recipes/create-operator.ts`) composing existing primitives (`actAs`, `randomKeys`, `resolveGate`, `addGateAddrs`, `buildAddressesTree`). Two small `define.ts` framework extensions (order-free positionals via `match` predicates; valueless boolean flags). `addGateAddrs` exposes its post-union address list so the proof needs no IPFS refetch.

**Tech Stack:** TypeScript ESM, viem, commander (via the declarative `RecipeCommand` registry), vitest (hermetic fake-client tests), OZ merkle trees via `@sm-lab/merkle`.

**Spec:** `docs/superpowers/specs/2026-07-21-csm-create-operator-design.md`

## Global Constraints

- ESM + extensionless imports (`from './x'`, never `'./x.js'`); `import type` for type-only imports.
- No DOM lib; `noUncheckedIndexedAccess` on (guard array access).
- Hermetic tests: no network, no chain — fake client + stubbed `fetch` only.
- Commits during work are UNSIGNED: `git commit --no-gpg-sign`.
- Prettier: single quotes, width 100, trailing commas. Prefer `Array#toSorted()`.
- Package gates before done: `build` · `types` · `test` · `oxlint tools/recipes` · `prettier --check "tools/recipes/**/*.{ts,json}"`.
- `--json` contract: one JSON value to stdout, bigints as strings (already handled by `defineCommand`).

---

### Task 1: Shared `deriveAddress` helper

Extract cm's local seed→address derivation into a shared module (the new recipe derives the default operator address from it). Formula MUST stay byte-identical (`keccak256(concat([seed, toHex(label)]))`, low 20 bytes) so seeded `seedCm` output is unchanged.

**Files:**
- Create: `tools/recipes/src/derive.ts`
- Modify: `tools/recipes/src/cm/index.ts` (replace local `deriveOperatorAddress`)
- Test: `tools/recipes/test/derive.test.ts`

**Interfaces:**
- Produces: `deriveAddress(seed: Hex, label: string): Hex` — lowercase 0x-hex address, deterministic.
- Consumers: Task 4 (`deriveAddress(seed, 'csm-operator')`), cm `seedCm` (`deriveAddress(seed, `cm-operator-${i}`)`).

- [ ] **Step 1: Write the failing test**

```ts
// tools/recipes/test/derive.test.ts
import { concat, keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { deriveAddress } from '../src/derive';

describe('deriveAddress', () => {
  it('is deterministic, label- and seed-sensitive', () => {
    const seed = `0x${'01'.repeat(32)}` as const;
    const a = deriveAddress(seed, 'csm-operator');
    expect(a).toBe(deriveAddress(seed, 'csm-operator'));
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(deriveAddress(seed, 'other')).not.toBe(a);
    expect(deriveAddress(`0x${'02'.repeat(32)}`, 'csm-operator')).not.toBe(a);
  });

  it('matches the former cm deriveOperatorAddress formula (seedCm compat)', () => {
    const seed = `0x${'aa'.repeat(32)}` as const;
    const h = keccak256(concat([seed, toHex('cm-operator-0')]));
    expect(deriveAddress(seed, 'cm-operator-0')).toBe(`0x${h.slice(-40)}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test test/derive.test.ts`
Expected: FAIL — `Cannot find module '../src/derive'` (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

```ts
// tools/recipes/src/derive.ts
import { concat, keccak256, toHex } from 'viem';
import type { Hex } from '@sm-lab/receipts';

/**
 * A deterministic address from a seed + label (low 20 bytes of keccak256(seed ‖ label)).
 * The shared origin for recipe-generated operator addresses — same formula the cm
 * seedCm derivation has always used, so seeded outputs are stable across the move.
 */
export function deriveAddress(seed: Hex, label: string): Hex {
  const h = keccak256(concat([seed, toHex(label)]));
  return `0x${h.slice(-40)}` as Hex;
}
```

In `tools/recipes/src/cm/index.ts`, delete the local helper:

```ts
/** A deterministic address from a seed + label (low 20 bytes of keccak — mirrors deriveExtra). */
function deriveOperatorAddress(seed: Hex, i: number): Hex {
  const h = keccak256(concat([seed, toHex(`cm-operator-${i}`)]));
  return `0x${h.slice(-40)}` as Hex;
}
```

add the import (keep the existing `concat`/`keccak256`/`toHex` viem imports — `deriveExtra` and `keySeed` still use them):

```ts
import { deriveAddress } from '../derive';
```

and replace the three call sites in `seedCm`:

```ts
  const operators: [Hex, Hex, Hex] = [
    deriveAddress(seed, 'cm-operator-0'),
    deriveAddress(seed, 'cm-operator-1'),
    deriveAddress(seed, 'cm-operator-2'),
  ];
```

- [ ] **Step 4: Run tests to verify they pass (derive + untouched cm suite)**

Run: `pnpm --filter @sm-lab/recipes test test/derive.test.ts test/cm.test.ts`
Expected: PASS (cm suite green proves the formula didn't drift).

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/derive.ts tools/recipes/src/cm/index.ts tools/recipes/test/derive.test.ts
git commit --no-gpg-sign -m "refactor(recipes): extract shared deriveAddress helper"
```

---

### Task 2: `define.ts` — order-free positionals (`match`) + boolean switch flags

Two framework extensions the new CLI command needs: (a) positional tokens assigned by predicate so `create-operator idvtc 10` and `create-operator 10` both parse; (b) valueless `--flag` switches (commander stores `true`; today every option assumes a string value).

**Files:**
- Modify: `tools/recipes/src/cli/define.ts`
- Test: `tools/recipes/test/cli-define.test.ts` (append two describes)

**Interfaces:**
- Produces: `OptionSpec.match?(token: string): boolean` — when ANY positional of a command declares `match`, each supplied positional token fills the FIRST unfilled positional whose predicate accepts it (no predicate = accepts anything); a token nobody accepts throws `unrecognized positional "<token>"`. Incompatible with a variadic (repeatable) positional — `defineCommand` throws at definition time.
- Produces: `OptionSpec.coerce` becomes OPTIONAL. A flag spec without a `<value>` placeholder is a boolean switch: present → `opts[key] = true`, absent → key omitted; `coerce` is bypassed for boolean raws.
- Consumers: Task 5's `create-operator` descriptor.

- [ ] **Step 1: Write the failing tests**

Append to `tools/recipes/test/cli-define.test.ts` (inside the top-level `describe('defineCommand', …)` block, after the existing `describe('positional arguments', …)`; reuses its `fakeConnect`):

```ts
  describe('order-free positionals (match)', () => {
    const omni: RecipeCommand<
      { selector?: string; keysCount?: number },
      { selector?: string; keysCount?: number }
    > = {
      name: 'omni',
      summary: 'omni',
      options: [
        {
          flag: '--selector <name>',
          key: 'selector',
          coerce: identity,
          positional: true,
          match: (t) => !/^\d+$/.test(t),
        },
        {
          flag: '--keys <n>',
          key: 'keysCount',
          coerce: toNumber,
          positional: true,
          match: (t) => /^\d+$/.test(t),
        },
      ],
      run: async (_ctx, o) => o,
      report: (r) => [`${r.selector ?? '-'}/${r.keysCount ?? '-'}`],
    };
    const omniProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(omni, fakeConnect));
      return p;
    };
    const runOmni = async (...args: string[]): Promise<string> => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await omniProgram().parseAsync(['--module', 'csm', 'omni', ...args], { from: 'user' });
      const out = log.mock.calls[0]![0] as string;
      log.mockRestore();
      return out;
    };

    it('assigns tokens by predicate in either order', async () => {
      expect(await runOmni('idvtc', '10')).toBe('idvtc/10');
      expect(await runOmni('10', 'idvtc')).toBe('idvtc/10');
      expect(await runOmni('10')).toBe('-/10');
      expect(await runOmni('idvtc')).toBe('idvtc/-');
      expect(await runOmni()).toBe('-/-');
    });

    it('rejects a token no unfilled positional accepts', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await omniProgram().parseAsync(['--module', 'csm', 'omni', '10', '12'], { from: 'user' });
      expect(err).toHaveBeenCalledWith('Error:', expect.stringContaining('unrecognized positional "12"'));
      err.mockRestore();
      exit.mockRestore();
    });

    it('a match positional cannot combine with a variadic positional', () => {
      expect(() =>
        defineCommand(
          {
            name: 'bad',
            summary: 'bad',
            options: [
              { flag: '--selector <s>', key: 's', coerce: identity, positional: true, match: () => true },
              { flag: '--address <a>', key: 'a', coerce: toAddresses, repeatable: true, positional: true },
            ],
            run: async () => ({}),
            report: () => [],
          },
          fakeConnect,
        ),
      ).toThrow(/variadic/);
    });
  });

  describe('boolean switch flags (no <value> placeholder)', () => {
    const sw: RecipeCommand<{ ext?: boolean }, { ext?: boolean }> = {
      name: 'sw',
      summary: 'sw',
      options: [{ flag: '--extended-manager-permissions', key: 'ext' }],
      run: async (_ctx, o) => o,
      report: (r) => [`ext=${r.ext ?? 'unset'}`],
    };
    const swProgram = () => {
      const p = new Command().option('--module <m>').exitOverride();
      p.addCommand(defineCommand(sw, fakeConnect));
      return p;
    };

    it('present → true; absent → key omitted', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await swProgram().parseAsync(['--module', 'csm', 'sw', '--extended-manager-permissions'], {
        from: 'user',
      });
      expect(log).toHaveBeenCalledWith('ext=true');
      log.mockClear();
      await swProgram().parseAsync(['--module', 'csm', 'sw'], { from: 'user' });
      expect(log).toHaveBeenCalledWith('ext=unset');
      log.mockRestore();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sm-lab/recipes test test/cli-define.test.ts`
Expected: FAIL — TS error `'match' does not exist in type 'OptionSpec'` / boolean descriptor missing `coerce`; existing tests still pass.

- [ ] **Step 3: Implement in `define.ts`**

(a) `OptionSpec`: make `coerce` optional, add `match` (replace the two members in place):

```ts
  // Method form (params are checked bivariantly under strictFunctionTypes) so that a
  // narrow coercer like toBigInt(s: string) stays assignable. Single-value coercers
  // receive string; repeatable coercers receive string[]. OPTIONAL: a flag spec without
  // a `<value>` placeholder is a boolean switch — commander stores `true` and coercion
  // is bypassed, so switches omit `coerce` entirely.
  coerce?(raw: string | string[]): unknown;
```

and after the `positional?: boolean;` member:

```ts
  /**
   * Positional-token predicate. When ANY positional of a command declares `match`, supplied
   * positional tokens are redistributed: each token (in CLI order) fills the FIRST unfilled
   * positional whose predicate accepts it (no predicate = accepts anything); a token nobody
   * accepts is an error. Makes two optional positionals order-free (`cmd idvtc 10` == `cmd 10
   * idvtc`). Incompatible with a variadic (repeatable) positional.
   */
  match?(token: string): boolean;
```

(b) In `defineCommand`, extend the variadic guard (right after the existing `variadicAt` check):

```ts
  if (positionals.some((o) => o.match) && variadicAt >= 0)
    throw new Error(`${desc.name}: match-based positionals cannot combine with a variadic positional`);
```

(c) In the action handler, replace the per-option lookup. Before the `for (const o of desc.options)` loop, build the assignment map:

```ts
      // Positional-value assignment: strict declaration order by default; when any positional
      // declares `match`, redistribute tokens by predicate (first unfilled acceptor wins).
      const assigned = new Map<OptionSpec, string | string[] | undefined>();
      if (positionals.some((p) => p.match)) {
        const tokens = positionalValues.filter((v): v is string => typeof v === 'string');
        for (const token of tokens) {
          const slot = positionals.find((p) => !assigned.has(p) && (p.match?.(token) ?? true));
          if (!slot) throw new Error(`unrecognized positional "${token}"`);
          assigned.set(slot, token);
        }
      } else {
        positionals.forEach((p, i) => assigned.set(p, positionalValues[i]));
      }
```

then inside the loop replace

```ts
        const posIndex = positionals.indexOf(o);
        const posVal = posIndex >= 0 ? positionalValues[posIndex] : undefined;
```

with

```ts
        const posVal = assigned.get(o);
```

and replace the final coercion line

```ts
        opts[o.key] = o.coerce(raw as string | string[]);
```

with

```ts
        // A boolean switch's raw is commander's stored `true` — no coercion applies.
        opts[o.key] =
          typeof raw === 'boolean' ? raw : o.coerce ? o.coerce(raw as string | string[]) : raw;
```

Note: the `throw` inside the action runs under `run(async () => …)`, so the error prints as `Error: unrecognized positional "12"` and exits 1 — that's what the test asserts.

- [ ] **Step 4: Run the full CLI test set to verify pass + no regression**

Run: `pnpm --filter @sm-lab/recipes test test/cli-define.test.ts test/cli-modules.test.ts test/cli-program.test.ts test/cli-json.test.ts test/cli-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/cli/define.ts tools/recipes/test/cli-define.test.ts
git commit --no-gpg-sign -m "feat(recipes): order-free positional match + boolean switch flags in CLI framework"
```

---

### Task 3: `addGateAddrs` exposes the post-union `addresses`

The gated create path needs the full allowlist to build the proof; `addGateAddrs` already computes it internally — return it.

**Files:**
- Modify: `tools/recipes/src/recipes/add-gate.ts`
- Test: `tools/recipes/test/add-gate.test.ts` (extend existing assertions)

**Interfaces:**
- Produces: `AddGateAddrsResult.addresses: Hex[]` — the full post-union allowlist, checksummed + `toSorted()` (exactly the tree's leaves in both the changed and no-op branches).
- Consumers: Task 4 (`buildAddressesTree(res.addresses).getProof([address])`).

- [ ] **Step 1: Extend the tests (failing)**

In `tools/recipes/test/add-gate.test.ts`:

In the first test (`reads the current tree from IPFS…`), after `expect(res.added).toEqual([getAddress(A(0x13))]);` add:

```ts
    expect(res.addresses).toEqual(union.map((a) => getAddress(a)).toSorted());
```

In the no-op test (`is a no-op (no writes)…`), after `expect(res.treeRoot).toBe(buildAddressesTree(current).root);` add:

```ts
    expect(res.addresses).toEqual(current.map((a) => getAddress(a)).toSorted());
```

In the fresh-gate test (`treats a fresh gate (empty treeCid)…`), after `expect(res.added).toEqual([getAddress(A(0x11))]);` add:

```ts
    expect(res.addresses).toEqual([getAddress(A(0x11))]);
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sm-lab/recipes test test/add-gate.test.ts`
Expected: FAIL — `res.addresses` is `undefined` (and a TS error on the property until the interface gains it).

- [ ] **Step 3: Implement**

In `tools/recipes/src/recipes/add-gate.ts`, add to `AddGateAddrsResult` (after `treeCid`):

```ts
  /** The full post-union allowlist (checksummed, sorted) — exactly the installed tree's leaves. */
  addresses: Hex[];
```

Add `addresses` to both return sites:

```ts
  if (added.length === 0) {
    return {
      treeRoot: buildAddressesTree(addresses).root as Hex,
      treeCid: curCid,
      addresses,
      added: [],
      changed: false,
    };
  }

  const { treeRoot, treeCid } = await setGateAddrs(ctx, { addresses, selector, cid: opts.cid });
  return { treeRoot, treeCid, addresses, added, changed: true };
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @sm-lab/recipes test test/add-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/recipes/add-gate.ts tools/recipes/test/add-gate.test.ts
git commit --no-gpg-sign -m "feat(recipes): addGateAddrs returns the post-union allowlist"
```

---

### Task 4: `createCsmOperator` recipe (permissionless + gated) + exports

**Files:**
- Create: `tools/recipes/src/recipes/create-operator.ts`
- Modify: `tools/recipes/src/index.ts` (exports)
- Test: `tools/recipes/test/create-operator.test.ts`

**Interfaces:**
- Consumes: `deriveAddress` (Task 1), `AddGateAddrsResult.addresses` (Task 3), plus existing `actAs`, `roleMember`, `contract`, `resolveGate`, `randomKeys`, `randomSeed`, `RESUME_ROLE`, `DEFAULT_ADMIN_ROLE`.
- Produces:

```ts
createCsmOperator(ctx: Ctx, opts?: CreateCsmOperatorOptions): Promise<CreateCsmOperatorResult>

interface CreateCsmOperatorOptions {
  keysCount?: number;                     // default 1; throws when < 1
  selector?: string;                      // absent → PermissionlessGate; 'ics'|'idvtc'|0x… → vetted gate
  address?: Hex;                          // default deriveAddress(seed, 'csm-operator'); checksummed either way
  manager?: Hex;                          // default zeroAddress (contract → sender)
  reward?: Hex;                           // default zeroAddress (contract → sender)
  extendedManagerPermissions?: boolean;   // default false
  seed?: Hex;                             // default randomSeed()
  fromCid?: string;                       // gated: passthrough to addGateAddrs
  cid?: string;                           // gated: passthrough to addGateAddrs
}
interface CreateCsmOperatorResult {
  noId: bigint;
  address: Hex;                           // checksummed operator/sender address
  publicKeys: Hex[];
  bond: bigint;                           // wei sent as value
  treeCid?: string;                       // gated path only
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// tools/recipes/test/create-operator.test.ts
import { buildAddressesTree } from '@sm-lab/merkle';
import { getAddress, parseEther, zeroAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAddress } from '../src/derive';
import { createCsmOperator } from '../src/recipes/create-operator';
import { RESUME_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const SEED = `0x${'01'.repeat(32)}` as const;
const PERM_GATE = A(0x0e); // csmBook().PermissionlessGate
const ICS_GATE = A(0x0d); // csmBook().IcsGate
const ACCOUNTING = A(0x02); // csmBook().Accounting
const ADMIN = A(0xd0);
const REQUEST = { functionName: 'addNodeOperatorETH', isCreateReq: true };
// Valid CID — a gate with a real allowlist carries one (isLikelyCid → true, fetched).
const CUR_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

const dumpResponse = (addrs: string[]): Response =>
  new Response(JSON.stringify(buildAddressesTree(addrs).dump()), { status: 200 });

const clearIpfsEnv = (): void => {
  delete process.env.IPFS_API_URL;
  delete process.env.IPFS_GATEWAY_URL;
  delete process.env.PINATA_JWT;
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_API_SECRET;
};

describe('createCsmOperator — permissionless (no selector)', () => {
  it('creates via PermissionlessGate: CURVE_ID bond, no proof, zero-address defaults', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('2.4') },
      simulate: { result: 5n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED });

    expect(res.noId).toBe(5n);
    expect(res.address).toBe(getAddress(deriveAddress(SEED, 'csm-operator')));
    expect(res.publicKeys).toHaveLength(1);
    expect(res.bond).toBe(parseEther('2.4'));
    expect(res.treeCid).toBeUndefined();

    const reads = byMethod('readContract') as any[];
    expect(reads.find((r) => r.functionName === 'CURVE_ID').address).toBe(PERM_GATE);
    const bond = reads.find((r) => r.functionName === 'getBondAmountByKeysCount');
    expect(bond.address).toBe(ACCOUNTING);
    expect(bond.args).toEqual([1n, 0n]);

    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.address).toBe(PERM_GATE);
    expect(sim.functionName).toBe('addNodeOperatorETH');
    expect(sim.account).toBe(res.address);
    expect(sim.value).toBe(parseEther('2.4'));
    expect(sim.args).toHaveLength(5); // no proof param on the permissionless gate
    expect(sim.args[0]).toBe(1n);
    expect(sim.args[3]).toEqual({
      managerAddress: zeroAddress,
      rewardAddress: zeroAddress,
      extendedManagerPermissions: false,
    });
    expect(sim.args[4]).toBe(zeroAddress); // referrer

    expect((byMethod('writeContract') as any[]).some((w) => w.isCreateReq)).toBe(true);
    expect(byMethod('impersonateAccount')).toContainEqual({ address: res.address });
    expect(byMethod('stopImpersonatingAccount')).toContainEqual({ address: res.address });
  });

  it('honours keysCount/address/manager/reward/extendedManagerPermissions overrides', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('4.8') },
      simulate: { result: 6n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, {
      seed: SEED,
      keysCount: 2,
      address: A(0xc1),
      manager: A(0xc2),
      reward: A(0xc3),
      extendedManagerPermissions: true,
    });

    expect(res.address).toBe(getAddress(A(0xc1)));
    expect(res.publicKeys).toHaveLength(2);
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.args[0]).toBe(2n);
    expect(sim.args[3]).toEqual({
      managerAddress: A(0xc2),
      rewardAddress: A(0xc3),
      extendedManagerPermissions: true,
    });
    const bond = (byMethod('readContract') as any[]).find(
      (r) => r.functionName === 'getBondAmountByKeysCount',
    );
    expect(bond.args).toEqual([2n, 0n]);
  });

  it('tops the balance up past the actAs 100 ETH when the bond needs it', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('150') },
      simulate: { result: 7n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED });

    const balances = byMethod('setBalance') as any[];
    expect(balances).toHaveLength(2); // actAs's 100 ETH, then the bond top-up
    expect(balances[1]).toEqual({ address: res.address, value: parseEther('160') });
  });

  it('guards: cm ctx and keysCount < 1 are rejected', async () => {
    const cmCtx = fakeCtx('cm', makeFakeClient().client);
    await expect(createCsmOperator(cmCtx, {})).rejects.toThrow(/requires ctx\.module === "csm"/);
    const csmCtx = fakeCtx('csm', makeFakeClient().client);
    await expect(createCsmOperator(csmCtx, { keysCount: 0 })).rejects.toThrow(/keysCount/);
  });
});

describe('createCsmOperator — gated (selector)', () => {
  beforeEach(clearIpfsEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIpfsEnv();
  });

  it('whitelists via add-gate, proves against the merged tree, curveId bond, reports treeCid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dumpResponse([A(0x11)])));
    const { client, byMethod } = makeFakeClient({
      reads: {
        treeCid: CUR_CID,
        getRoleMember: ADMIN,
        isPaused: false,
        curveId: 2n,
        getBondAmountByKeysCount: parseEther('1.5'),
      },
      simulate: { result: 9n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED, selector: 'ics', cid: 'new-cid' });

    expect(res.noId).toBe(9n);
    expect(res.treeCid).toBe('new-cid');

    // proof is against the merged (current ∪ operator) tree that add-gate installed
    const union = [getAddress(A(0x11)), res.address].toSorted();
    const tree = buildAddressesTree(union);
    const writes = byMethod('writeContract') as any[];
    const set = writes.find((w) => w.functionName === 'setTreeParams');
    expect(set.args).toEqual([tree.root, 'new-cid']);
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.address).toBe(ICS_GATE);
    expect(sim.args).toHaveLength(6); // keysCount, keys, sigs, mgmt, proof, referrer
    expect(sim.args[4]).toEqual(tree.getProof([res.address]));
    expect(sim.args[5]).toBe(zeroAddress);
    expect(sim.value).toBe(parseEther('1.5'));

    // vetted-gate curve, not CURVE_ID
    const reads = byMethod('readContract') as any[];
    expect(reads.find((r) => r.functionName === 'curveId').address).toBe(ICS_GATE);
    expect(reads.find((r) => r.functionName === 'getBondAmountByKeysCount').args).toEqual([1n, 2n]);
  });

  it('resumes a paused gate as admin before creating (fresh gate → single-leaf empty proof)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        treeCid: '', // fresh gate — empty allowlist, no IPFS read
        getRoleMember: ADMIN,
        isPaused: true,
        curveId: 2n,
        getBondAmountByKeysCount: parseEther('1.5'),
      },
      simulate: { result: 3n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED, selector: 'ics', cid: 'new-cid' });

    const writes = byMethod('writeContract') as any[];
    const resumeGrant = writes.findIndex(
      (w) => w.functionName === 'grantRole' && w.args[0] === RESUME_ROLE,
    );
    const resume = writes.findIndex((w) => w.functionName === 'resume');
    const create = writes.findIndex((w) => w.isCreateReq);
    expect(resumeGrant).toBeGreaterThanOrEqual(0);
    expect(resume).toBeGreaterThan(resumeGrant);
    expect(create).toBeGreaterThan(resume);
    expect(writes[resume].account).toBe(ADMIN);

    // single-leaf tree → empty proof
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.args[4]).toEqual([]);
    expect(res.address).toBe(getAddress(deriveAddress(SEED, 'csm-operator')));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sm-lab/recipes test test/create-operator.test.ts`
Expected: FAIL — `Cannot find module '../src/recipes/create-operator'`.

- [ ] **Step 3: Write the implementation**

```ts
// tools/recipes/src/recipes/create-operator.ts
import { buildAddressesTree } from '@sm-lab/merkle';
import { permissionlessGateAbi, vettedGateAbi } from '@sm-lab/receipts';
import type { CsmAddressBook, Hex } from '@sm-lab/receipts';
import { getAddress, parseEther, zeroAddress } from 'viem';
import { actAs, roleMember } from '../act-as';
import { contract, resolveGate, type Ctx } from '../context';
import { deriveAddress } from '../derive';
import { randomKeys } from '../keys';
import { randomSeed } from '../random';
import { DEFAULT_ADMIN_ROLE, RESUME_ROLE } from '../roles';
import { addGateAddrs } from './add-gate';

export interface CreateCsmOperatorOptions {
  /** Validator keys submitted at creation (CSM requires ≥ 1). Default 1. */
  keysCount?: number;
  /**
   * Entry gate — the operator's "type" (the gate pins the bond curve). Absent →
   * PermissionlessGate (no proof); 'ics' | 'idvtc' | a raw 0x… gate address → vetted gate
   * (the address is appended to the gate allowlist via addGateAddrs and proven).
   */
  selector?: string;
  /** The operator/sender address. Default: deriveAddress(seed, 'csm-operator'). */
  address?: Hex;
  /** managementProperties.managerAddress; zeroAddress (default) → contract uses the sender. */
  manager?: Hex;
  /** managementProperties.rewardAddress; zeroAddress (default) → contract uses the sender. */
  reward?: Hex;
  /** managementProperties.extendedManagerPermissions. Default false. */
  extendedManagerPermissions?: boolean;
  /** Injectable seed for reproducible keys + derived address. */
  seed?: Hex;
  /** Gated: read the current tree from this CID instead of the gate's treeCid(). */
  fromCid?: string;
  /** Gated: skip pinning the merged tree by supplying its CID (hermetic-test bypass). */
  cid?: string;
}

export interface CreateCsmOperatorResult {
  noId: bigint;
  /** The created operator's sender/owner address (checksummed). */
  address: Hex;
  publicKeys: Hex[];
  /** Wei sent as the creation bond. */
  bond: bigint;
  /** Gated path only — the re-pinned allowlist CID. */
  treeCid?: string;
}

/**
 * Create a CSM node operator through an entry gate, submitting `keysCount` fresh keys and the
 * exact ETH bond. No selector → PermissionlessGate; 'ics'/'idvtc'/0x… → the vetted gate: the
 * address is persistently whitelisted first (addGateAddrs) and proven against the merged tree.
 * A paused vetted gate is resumed as its admin (VettedGate creation is `whenResumed`). No
 * post-assertions — returns the simulate-captured noId.
 */
export async function createCsmOperator(
  ctx: Ctx,
  opts: CreateCsmOperatorOptions = {},
): Promise<CreateCsmOperatorResult> {
  if (ctx.module !== 'csm') {
    throw new Error('@sm-lab/recipes: createCsmOperator requires ctx.module === "csm"');
  }
  const keysCount = opts.keysCount ?? 1;
  if (keysCount < 1) {
    throw new Error('@sm-lab/recipes: createCsmOperator needs keysCount ≥ 1 (CSM requires a key at creation)');
  }
  const seed = opts.seed ?? randomSeed();
  const address = getAddress(opts.address ?? deriveAddress(seed, 'csm-operator'));
  const { publicKeys, packedKeys, packedSignatures } = await randomKeys(keysCount, seed);
  const mgmt = {
    managerAddress: opts.manager ?? zeroAddress,
    rewardAddress: opts.reward ?? zeroAddress,
    extendedManagerPermissions: opts.extendedManagerPermissions ?? false,
  } as const;

  // Gate resolution: the entry gate IS the operator's type (it pins the bond curve).
  let curveId: bigint;
  let gateAddress: Hex;
  let proof: Hex[] | undefined;
  let treeCid: string | undefined;
  if (opts.selector === undefined) {
    gateAddress = (ctx.addresses as CsmAddressBook).PermissionlessGate;
    curveId = (await ctx.client.readContract({
      address: gateAddress,
      abi: permissionlessGateAbi,
      functionName: 'CURVE_ID',
    })) as bigint;
  } else {
    gateAddress = resolveGate(ctx, opts.selector);
    const gate = { address: gateAddress, abi: vettedGateAbi } as const;
    const merged = await addGateAddrs(ctx, {
      selector: opts.selector,
      addresses: [address],
      fromCid: opts.fromCid,
      cid: opts.cid,
    });
    treeCid = merged.treeCid;
    proof = buildAddressesTree(merged.addresses).getProof([address]) as Hex[];
    // VettedGate creation is whenResumed — resume a paused gate as its admin first.
    const paused = await ctx.client.readContract({ ...gate, functionName: 'isPaused' });
    if (paused) {
      const admin = await roleMember(ctx, gate, DEFAULT_ADMIN_ROLE);
      await actAs(ctx, admin, async (from) => {
        await ctx.client.writeContract({
          ...gate,
          functionName: 'grantRole',
          args: [RESUME_ROLE, admin],
          account: from,
          chain: null,
        });
        await ctx.client.writeContract({ ...gate, functionName: 'resume', account: from, chain: null });
      });
    }
    curveId = (await ctx.client.readContract({ ...gate, functionName: 'curveId' })) as bigint;
  }

  const acc = contract(ctx, 'Accounting');
  const bond = (await ctx.client.readContract({
    ...acc,
    functionName: 'getBondAmountByKeysCount',
    args: [BigInt(keysCount), curveId],
  })) as bigint;

  const noId = await actAs(ctx, address, async (from) => {
    // actAs funds 100 ETH on entry — enough for most bonds; top up when the bond outgrows it.
    if (bond + parseEther('1') > parseEther('100')) {
      await ctx.client.setBalance({ address: from, value: bond + parseEther('10') });
    }
    const { result, request } = proof
      ? await ctx.client.simulateContract({
          address: gateAddress,
          abi: vettedGateAbi,
          functionName: 'addNodeOperatorETH',
          args: [BigInt(keysCount), packedKeys, packedSignatures, mgmt, proof, zeroAddress],
          account: from,
          value: bond,
        })
      : await ctx.client.simulateContract({
          address: gateAddress,
          abi: permissionlessGateAbi,
          functionName: 'addNodeOperatorETH',
          args: [BigInt(keysCount), packedKeys, packedSignatures, mgmt, zeroAddress],
          account: from,
          value: bond,
        });
    await ctx.client.writeContract({ ...request, chain: null });
    return result as bigint;
  });

  return { noId, address, publicKeys, bond, ...(treeCid !== undefined ? { treeCid } : {}) };
}
```

Add to `tools/recipes/src/index.ts` (next to the other gate recipe exports):

```ts
export { createCsmOperator } from './recipes/create-operator';
export type {
  CreateCsmOperatorOptions,
  CreateCsmOperatorResult,
} from './recipes/create-operator';
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @sm-lab/recipes test test/create-operator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Types gate (viem tuple/abi typing is the risk here)**

Run: `pnpm --filter @sm-lab/recipes types`
Expected: clean. If the `mgmt` tuple errors, keep the object literal inline in `args` (viem narrows better without the intermediate `as const` binding).

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/recipes/create-operator.ts tools/recipes/src/index.ts tools/recipes/test/create-operator.test.ts
git commit --no-gpg-sign -m "feat(recipes): createCsmOperator — csm operator creation via permissionless/vetted gates"
```

---

### Task 5: CLI `csm create-operator` command + README

**Files:**
- Modify: `tools/recipes/src/cli/commands/csm.ts`
- Modify: `tools/recipes/README.md` (command examples)
- Test: `tools/recipes/test/cli-modules.test.ts`

**Interfaces:**
- Consumes: `createCsmOperator` + `CreateCsmOperatorResult` (Task 4), `match`/boolean-switch support (Task 2), `toNumber`/`toAddressValue`/`toHexValue`/`identity` coercers.
- Produces: `sm-recipes csm create-operator [selector] [keys]` — order-free positionals; flags `--selector --keys --address --manager --reward --extended-manager-permissions --seed --from-cid --cid`.

- [ ] **Step 1: Write the failing tests**

In `tools/recipes/test/cli-modules.test.ts`:

Update the csm command-list assertion:

```ts
  it('csm commands all force module csm', () => {
    expect(csmCommands.map((c) => c.name).toSorted()).toEqual(
      ['add-gate', 'create-operator', 'resolve-gate', 'set-gate'].toSorted(),
    );
    expect(csmCommands.every((c) => c.module === 'csm')).toBe(true);
  });
```

Append a new describe (add the needed imports at the top of the file):

```ts
import { Command } from 'commander';
import { parseEther } from 'viem';
import { vi } from 'vitest';
import { makeFakeClient } from './helpers/fake-client';
import { fakeCtx, A } from './helpers/book';
```

```ts
describe('csm create-operator CLI forms', () => {
  const co = csmCommands.find((c) => c.name === 'create-operator')!;
  const SEED = `0x${'01'.repeat(32)}`;

  function coProgram() {
    const fake = makeFakeClient({
      reads: {
        CURVE_ID: 0n,
        curveId: 2n,
        treeCid: '',
        getRoleMember: A(0xd0),
        isPaused: false,
        getBondAmountByKeysCount: parseEther('2.4'),
      },
      simulate: { result: 1n, request: { functionName: 'addNodeOperatorETH' } },
    });
    const connect = async () => fakeCtx('csm', fake.client);
    const p = new Command().option('--module <m>').option('--json').exitOverride();
    p.addCommand(defineCommand(co, connect as never));
    return { p, fake };
  }

  const runForm = async (...args: string[]) => {
    const { p, fake } = coProgram();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await p.parseAsync(['create-operator', ...args, '--seed', SEED], { from: 'user' });
    log.mockRestore();
    return fake.byMethod('simulateContract')[0] as any;
  };

  it('declares [selector] [keys] positionals', () => {
    const args = defineCommand(co).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['selector', 'keys']);
  });

  it('bare form → permissionless, 1 key', async () => {
    const sim = await runForm();
    expect(sim.args).toHaveLength(5);
    expect(sim.args[0]).toBe(1n);
  });

  it('count-only form → permissionless, N keys', async () => {
    const sim = await runForm('3');
    expect(sim.args).toHaveLength(5);
    expect(sim.args[0]).toBe(3n);
  });

  it('selector-only form → gated, 1 key', async () => {
    const sim = await runForm('ics', '--cid', 'x');
    expect(sim.args).toHaveLength(6); // proof present
    expect(sim.args[0]).toBe(1n);
  });

  it('selector+count and count+selector both parse (order-free)', async () => {
    const a = await runForm('ics', '2', '--cid', 'x');
    expect(a.args[0]).toBe(2n);
    expect(a.args).toHaveLength(6);
    const b = await runForm('2', 'ics', '--cid', 'x');
    expect(b.args[0]).toBe(2n);
    expect(b.args).toHaveLength(6);
  });

  it('boolean switch maps to extendedManagerPermissions', async () => {
    const sim = await runForm('--extended-manager-permissions');
    expect(sim.args[3]).toMatchObject({ extendedManagerPermissions: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @sm-lab/recipes test test/cli-modules.test.ts`
Expected: FAIL — command list mismatch (`create-operator` missing).

- [ ] **Step 3: Implement the descriptor**

In `tools/recipes/src/cli/commands/csm.ts` — extend the imports:

```ts
import { formatEther } from 'viem';
import {
  identity,
  toAddressValue,
  toHexValue,
  toNumber,
  toAddresses,
  type RecipeCommand,
} from '../define';
import {
  createCsmOperator,
  type CreateCsmOperatorOptions,
  type CreateCsmOperatorResult,
} from '../../recipes/create-operator';
```

and append to `csmCommands` (after `resolve-gate`):

```ts
  {
    name: 'create-operator',
    summary: 'create a node operator with fresh keys + bond (PermissionlessGate; selector → vetted gate)',
    module: 'csm',
    // Order-free positionals: `create-operator [selector] [keys]` in either order — digits fill
    // --keys, ics/idvtc/0x… fills --selector (OptionSpec.match redistribution).
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        positional: true,
        match: (t: string) => /^(ics|idvtc|0x[0-9a-fA-F]{40})$/.test(t),
        description: `${csmSelectorHelp} (default: PermissionlessGate)`,
      },
      {
        flag: '--keys <n>',
        key: 'keysCount',
        coerce: toNumber,
        positional: true,
        match: (t: string) => /^\d+$/.test(t),
        description: 'validator keys to submit at creation (default: 1)',
      },
      {
        flag: '--address <addr>',
        key: 'address',
        coerce: toAddressValue,
        description: 'operator address (default: derived from --seed)',
      },
      {
        flag: '--manager <addr>',
        key: 'manager',
        coerce: toAddressValue,
        description: 'manager address (default: the operator address)',
      },
      {
        flag: '--reward <addr>',
        key: 'reward',
        coerce: toAddressValue,
        description: 'reward address (default: the operator address)',
      },
      {
        flag: '--extended-manager-permissions',
        key: 'extendedManagerPermissions',
        description: 'set extendedManagerPermissions on the new operator',
      },
      {
        flag: '--seed <hex>',
        key: 'seed',
        coerce: toHexValue,
        description: 'determinism seed for the keys + derived address',
      },
      {
        flag: '--from-cid <cid>',
        key: 'fromCid',
        coerce: identity,
        description: "gated only: read the current tree from this CID instead of the gate's treeCid()",
      },
      {
        flag: '--cid <cid>',
        key: 'cid',
        coerce: identity,
        description: 'gated only: skip IPFS pinning of the merged tree by supplying its CID',
      },
    ],
    run: (ctx, o: CreateCsmOperatorOptions) => createCsmOperator(ctx, o),
    report: (r: CreateCsmOperatorResult) => [
      `operator ${r.noId} created — ${r.address}`,
      `bond: ${formatEther(r.bond)} ETH for ${r.publicKeys.length} key(s)`,
      ...r.publicKeys.map((pk) => `  ${pk}`),
      ...(r.treeCid ? [`gate tree CID: ${r.treeCid}`] : []),
    ],
  },
```

(If `toAddresses` was already imported for set-gate/add-gate, keep the import list deduplicated — only add what's new.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @sm-lab/recipes test test/cli-modules.test.ts test/cli-program.test.ts test/cli-json.test.ts`
Expected: PASS.

- [ ] **Step 5: README examples**

In `tools/recipes/README.md`, add to the csm examples block (next to the existing `sm-recipes csm set-gate idvtc …` line):

```
sm-recipes csm create-operator                    # PermissionlessGate, 1 key
sm-recipes csm create-operator 10                 # PermissionlessGate, 10 keys
sm-recipes csm create-operator idvtc              # IdvtcGate (whitelists + proves), 1 key
sm-recipes csm create-operator idvtc 10           # order-free: `10 idvtc` works too
sm-recipes csm create-operator --address 0xabc... --manager 0xdef... --extended-manager-permissions
```

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/cli/commands/csm.ts tools/recipes/test/cli-modules.test.ts tools/recipes/README.md
git commit --no-gpg-sign -m "feat(recipes): sm-recipes csm create-operator command"
```

---

### Task 6: Changeset + full package gates

**Files:**
- Create: `.changeset/csm-create-operator.md`

- [ ] **Step 1: Changeset**

```md
---
'@sm-lab/recipes': minor
---

`createCsmOperator` recipe + `sm-recipes csm create-operator`: create a CSM node operator with
fresh keys and exact ETH bond through the PermissionlessGate (default) or a vetted gate
(`ics`/`idvtc` — persistently whitelists the address and proves it). CLI gains order-free
positionals (`create-operator idvtc 10` == `create-operator 10 idvtc`) and boolean switch flags;
`addGateAddrs` now returns the post-union allowlist `addresses`.
```

- [ ] **Step 2: Full gates**

```bash
pnpm --filter @sm-lab/recipes build
pnpm --filter @sm-lab/recipes types
pnpm --filter @sm-lab/recipes test
pnpm oxlint tools/recipes
pnpm prettier --check "tools/recipes/**/*.{ts,json}"
```

Expected: all clean. If prettier flags formatting, run `pnpm prettier --write` on the offending files and re-check.

- [ ] **Step 3: Commit**

```bash
git add .changeset/csm-create-operator.md
git commit --no-gpg-sign -m "chore: changeset for csm create-operator"
```

---

## Self-review notes

- Spec coverage: gate default/selector (T4), persistent add-gate + proof (T3+T4), paused resume (T4), address/manager/reward/ext-perms/seed opts (T4), bond + funding boundary (T4), CLI 4 sketch forms + order-free + boolean switch (T2+T5), `addresses` union field (T3), deriveAddress extraction (T1), README + changeset (T5+T6). No gaps.
- `match` redistribution only touches commands that declare `match` — existing positional tests must stay green (T2 step 4 runs them).
- Types risk is concentrated in viem's abi-typed `simulateContract` args (T4 step 5 gates it).
