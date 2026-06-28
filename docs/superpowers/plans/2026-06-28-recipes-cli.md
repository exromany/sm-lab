# Recipes CLI (increment 6g) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a published `csm-recipes` CLI over `@csm-lab/recipes` — a run-and-exit front-end that prepares CSM state on an anvil fork, 1:1 with the recipe surface.

**Architecture:** A declarative command registry. Each recipe is described as a data object (`RecipeCommand`); one `defineCommand` factory turns each descriptor into a commander `Command`, handling global context (`connect()`), per-field coercion, `--json` vs human output, and error exit uniformly. `buildProgram(connectImpl)` wires all descriptors into the command tree; `connectImpl` is injected so tests stay hermetic. Shared recipes are top-level (module via `--module`); cm/csm-only recipes nest under `cm`/`csm` groups that force `ctx.module`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), commander, viem (`parseEther`/`isHex`/`isAddress`), tsdown, vitest. Mirrors `tools/merkle/src/cli.ts`.

## Global Constraints

- **ESM + extensionless imports** — write `from './x'`, never `'./x.js'`. Use `import type` for type-only imports.
- **No DOM lib** (`lib: ["ES2023"]`); `noUncheckedIndexedAccess` is on — guard array access / default destructures.
- **tsdown output is `.mjs` / `.d.mts`** — `bin`/`exports`/`types` must match.
- **commander `--no-*` is a boolean NEGATION** — never name a value flag `--no-id`. The node-operator id flag is `--operator-id`; the OptionSpec `key` (the recipe opts property, e.g. `noId`) is decoupled from the commander flag via `flagProp()`.
- **Amounts are ETH**, coerced with viem `parseEther` (string→bigint, never float). 1 wei (`0.000000000000000001`) must round-trip to `1n`.
- **Hermetic tests** — no network, no chain. `connectImpl` is the injection seam; the real recipes' behaviour is already covered by their own fake-client tests, so CLI tests cover wiring/coercion/reporting only.
- **Lint/format:** oxlint + prettier (single quotes, width 100, trailing commas). Prefer `Array#toSorted()`.
- Per-package gates before done: `pnpm --filter @csm-lab/recipes build · types · test`, `pnpm exec oxlint tools/recipes`, `pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"`.

---

### Task 1: The `define.ts` core — coercers + factory

**Files:**
- Create: `tools/recipes/src/cli/define.ts`
- Test: `tools/recipes/test/cli-define.test.ts`

**Interfaces:**
- Consumes: `connect`, `Ctx` from `../context` (existing).
- Produces:
  - `interface OptionSpec { flag: string; key: string; coerce: (raw: string | string[]) => unknown; required?: boolean; repeatable?: boolean; description?: string }`
  - `interface RecipeCommand<O = Record<string, unknown>, R = unknown> { name: string; summary: string; options: OptionSpec[]; run: (ctx: Ctx, opts: O) => Promise<R> | R; report: (result: R, opts: O) => string[]; module?: 'cm' | 'csm'; needsClMock?: boolean }`
  - Coercers: `toBigInt(s)`, `toNumber(s)`, `toEth(s)` (→ wei bigint), `toHexValue(s)`, `toAddressValue(s)`, `identity(s)`, `toPairs(arr)` (`[bigint,bigint][]`), `toAddresses(arr)` (`Hex[]`).
  - `flagProp(flag: string): string` — commander's camelCased property name for a flag.
  - `bigintReplacer(_k, v)`, `run(fn)`, `defineCommand(desc, connectImpl?): Command`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/recipes/test/cli-define.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import {
  toBigInt,
  toNumber,
  toEth,
  toHexValue,
  toAddressValue,
  toPairs,
  toAddresses,
  flagProp,
  bigintReplacer,
  defineCommand,
  type RecipeCommand,
} from '../src/cli/define';

describe('coercers', () => {
  it('toBigInt parses, throws on garbage', () => {
    expect(toBigInt('42')).toBe(42n);
    expect(() => toBigInt('x')).toThrow();
  });
  it('toNumber parses, throws on NaN', () => {
    expect(toNumber('3')).toBe(3);
    expect(() => toNumber('x')).toThrow('not a number');
  });
  it('toEth: 1 wei round-trips (string parse, not float)', () => {
    expect(toEth('0.000000000000000001')).toBe(1n);
    expect(toEth('1')).toBe(10n ** 18n);
    expect(toEth('1.5')).toBe(1_500_000_000_000_000_000n);
  });
  it('toHexValue / toAddressValue validate', () => {
    expect(toHexValue('0xabcd')).toBe('0xabcd');
    expect(() => toHexValue('nope')).toThrow();
    expect(() => toAddressValue('0x123')).toThrow();
  });
  it('toPairs / toAddresses map repeatable input', () => {
    expect(toPairs(['0:3400', '1:6600'])).toEqual([[0n, 3400n], [1n, 6600n]]);
    expect(toAddresses(['0x' + '1'.repeat(40)])).toEqual(['0x' + '1'.repeat(40)]);
  });
});

describe('flagProp', () => {
  it('camelCases the long flag name', () => {
    expect(flagProp('--operator-id <id>')).toBe('operatorId');
    expect(flagProp('-s, --seed <hex>')).toBe('seed');
    expect(flagProp('--max-amount <eth>')).toBe('maxAmount');
  });
});

describe('bigintReplacer', () => {
  it('stringifies bigints', () => {
    expect(JSON.parse(JSON.stringify({ a: 5n }, bigintReplacer))).toEqual({ a: '5' });
  });
});

describe('defineCommand', () => {
  const fakeCtx = { module: 'csm' } as never;
  const fakeConnect = vi.fn(async () => fakeCtx);

  const desc: RecipeCommand<{ noId: bigint }, { ok: bigint }> = {
    name: 'demo',
    summary: 'demo',
    options: [{ flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true }],
    run: async (_ctx, opts) => ({ ok: opts.noId }),
    report: (r) => [`ok ${r.ok}`],
  };

  function program(connect = fakeConnect) {
    const p = new Command()
      .option('--rpc-url <url>')
      .option('--module <m>')
      .option('--cl-mock-url <url>')
      .option('--json')
      .exitOverride();
    p.addCommand(defineCommand(desc, connect));
    return p;
  }

  it('builds ctx from globals, coerces opts, prints human output', async () => {
    fakeConnect.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(
      ['--rpc-url', 'http://x', '--module', 'csm', 'demo', '--operator-id', '7'],
      { from: 'user' },
    );
    expect(fakeConnect).toHaveBeenCalledWith({ module: 'csm', rpcUrl: 'http://x', clMockUrl: undefined });
    expect(log).toHaveBeenCalledWith('ok 7');
    log.mockRestore();
  });

  it('--json emits the raw result with bigints as strings', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await program().parseAsync(
      ['--rpc-url', 'http://x', '--module', 'csm', '--json', 'demo', '--operator-id', '7'],
      { from: 'user' },
    );
    expect(log).toHaveBeenCalledWith(JSON.stringify({ ok: '7' }, null, 2));
    log.mockRestore();
  });

  it('exits non-zero when --rpc-url and RPC_URL are both missing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    delete process.env.RPC_URL;
    await program().parseAsync(['--module', 'csm', 'demo', '--operator-id', '7'], { from: 'user' });
    expect(err).toHaveBeenCalledWith('Error:', expect.stringContaining('--rpc-url'));
    expect(exit).toHaveBeenCalledWith(1);
    err.mockRestore();
    exit.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-define.test.ts`
Expected: FAIL — cannot resolve `../src/cli/define`.

- [ ] **Step 3: Write the implementation**

```ts
// tools/recipes/src/cli/define.ts
import { Command } from 'commander';
import { isAddress, isHex, parseEther } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { connect, type Ctx } from '../context';

export interface OptionSpec {
  /** commander flag spec, e.g. '--operator-id <id>'. NEVER use a `--no-*` long name (negation). */
  flag: string;
  /** the recipe opts property this maps to, e.g. 'noId' (decoupled from the flag). */
  key: string;
  coerce: (raw: string | string[]) => unknown;
  required?: boolean;
  repeatable?: boolean;
  description?: string;
}

export interface RecipeCommand<O = Record<string, unknown>, R = unknown> {
  name: string;
  summary: string;
  options: OptionSpec[];
  run: (ctx: Ctx, opts: O) => Promise<R> | R;
  report: (result: R, opts: O) => string[];
  /** cm/csm-only commands set this; it forces ctx.module and overrides global --module. */
  module?: 'cm' | 'csm';
  needsClMock?: boolean;
}

// --- coercers (string → typed) ---
export function toBigInt(s: string): bigint {
  return BigInt(s); // throws SyntaxError on garbage
}
export function toNumber(s: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`not a number: ${s}`);
  return n;
}
/** ETH (decimal string) → wei bigint. String-based; 1 wei → 1n. */
export function toEth(s: string): bigint {
  return parseEther(s);
}
export function toHexValue(s: string): Hex {
  if (!isHex(s)) throw new Error(`not a 0x-hex value: ${s}`);
  return s;
}
export function toAddressValue(s: string): Hex {
  if (!isAddress(s)) throw new Error(`not an address: ${s}`);
  return s as Hex;
}
export function identity(s: string): string {
  return s;
}
/** Repeatable '--pair <noId:bps>' → [bigint, bigint][]. */
export function toPairs(raw: string[]): [bigint, bigint][] {
  return raw.map((p) => {
    const [a, b] = p.split(':');
    if (a === undefined || b === undefined) throw new Error(`bad pair "${p}", want noId:bps`);
    return [BigInt(a), BigInt(b)] as [bigint, bigint];
  });
}
/** Repeatable '--address <addr>' → Hex[]. */
export function toAddresses(raw: string[]): Hex[] {
  return raw.map(toAddressValue);
}

/** commander's camelCased property name for a flag spec (mirrors commander's own rule). */
export function flagProp(flag: string): string {
  const long = flag.split(/[ ,]+/).find((t) => t.startsWith('--'));
  const name = (long ?? flag).replace(/^--/, '').replace(/<.*$/, '').trim();
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

/** Run an async action; print thrown errors cleanly and exit non-zero. */
export function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function defineCommand(desc: RecipeCommand, connectImpl: typeof connect = connect): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  for (const o of desc.options) {
    if (o.repeatable) cmd.option(o.flag, o.description ?? '', collect, []);
    else cmd.option(o.flag, o.description ?? '');
  }
  cmd.action((_local: unknown, command: Command) => {
    run(async () => {
      const g = command.optsWithGlobals() as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      for (const o of desc.options) {
        const raw = g[flagProp(o.flag)];
        const empty = raw === undefined || (o.repeatable && (raw as string[]).length === 0);
        if (empty) {
          if (o.required) throw new Error(`missing required option ${o.flag.split(' ')[0]}`);
          continue;
        }
        opts[o.key] = o.coerce(raw as string | string[]);
      }
      const moduleName = desc.module ?? (g.module as 'csm' | 'cm' | undefined);
      if (!moduleName) throw new Error('set --module <csm|cm>');
      const rpcUrl = (g.rpcUrl as string | undefined) ?? process.env.RPC_URL;
      if (!rpcUrl) throw new Error('set --rpc-url or RPC_URL');
      const clMockUrl = (g.clMockUrl as string | undefined) ?? process.env.CL_MOCK_URL;
      if (desc.needsClMock && !clMockUrl)
        throw new Error(`${desc.name} needs --cl-mock-url or CL_MOCK_URL`);

      const ctx = await connectImpl({ module: moduleName, rpcUrl, clMockUrl });
      const result = await desc.run(ctx, opts);
      if (g.json) {
        console.log(JSON.stringify(result === undefined ? { ok: true } : result, bigintReplacer, 2));
      } else {
        for (const line of desc.report(result, opts)) console.log(line);
      }
    });
  });
  return cmd;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-define.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/cli/define.ts tools/recipes/test/cli-define.test.ts
git commit -m "feat(recipes): cli command-registry core (define.ts)"
```

---

### Task 2: Shared command descriptors

**Files:**
- Create: `tools/recipes/src/cli/commands/shared.ts`
- Test: `tools/recipes/test/cli-shared.test.ts`

**Interfaces:**
- Consumes: `OptionSpec`, `RecipeCommand`, coercers from `../define`; recipe functions from `../../recipes/*` and `../../recipes/reads`/`chain`.
- Produces: `export const sharedCommands: RecipeCommand[]` — 27 descriptors.

**Notes (resolved design points):**
- `warp`/`snapshot`/`revert` have non-`(ctx, opts)` recipe signatures, so their `run` is a thin adapter (`(ctx, opts) => warpBy(ctx, opts.by)`).
- `submit-rewards` composes `submitRewards(ctx, await makeRewards(ctx, opts))` — the one deliberate non-1:1 ergonomic (the *recipe* `submitRewards` takes a `RewardsReport`; the *command* builds-then-submits with the same `--seed`/`--tree-cid`/`--log-cid` flags). `previousCumulatives`/`now` are out of CLI scope.
- `--by` is **seconds** (1:1 with `warpBy(ctx, seconds)`); duration sugar (`7d`) is out of scope.

- [ ] **Step 1: Write the failing test**

```ts
// tools/recipes/test/cli-shared.test.ts
import { describe, expect, it } from 'vitest';
import { sharedCommands } from '../src/cli/commands/shared';
import { flagProp } from '../src/cli/define';

describe('sharedCommands', () => {
  it('exposes the expected command names', () => {
    const names = sharedCommands.map((c) => c.name).toSorted();
    expect(names).toEqual(
      [
        'add-bond', 'add-keys', 'cancel-penalty', 'cl-activate', 'compensate-penalty',
        'confirm-manager', 'confirm-reward', 'create-bond-debt', 'deposit', 'exit',
        'get-key-balance', 'get-pubkey', 'increase-allocated-balance', 'make-rewards',
        'operator-info', 'propose-manager', 'propose-reward', 'report-penalty', 'revert',
        'settle-penalty', 'slash', 'snapshot', 'submit-rewards', 'top-up-active-keys',
        'unvet', 'warp', 'withdraw',
      ].toSorted(),
    );
  });
  it('every option has a coerce fn and a non-negation flag', () => {
    for (const c of sharedCommands)
      for (const o of c.options) {
        expect(typeof o.coerce).toBe('function');
        expect(o.flag.startsWith('--no-')).toBe(false);
        expect(flagProp(o.flag).length).toBeGreaterThan(0);
      }
  });
  it('cl-activate requires cl-mock', () => {
    expect(sharedCommands.find((c) => c.name === 'cl-activate')?.needsClMock).toBe(true);
  });
  it('a report renders a known result', () => {
    const addKeys = sharedCommands.find((c) => c.name === 'add-keys')!;
    expect(addKeys.report({ publicKeys: ['0xaa', '0xbb'] }, { noId: 0n, count: 2 })).toEqual([
      'operator 0: +2 keys',
      'pubkeys: 0xaa, 0xbb',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-shared.test.ts`
Expected: FAIL — cannot resolve `../src/cli/commands/shared`.

- [ ] **Step 3: Write the implementation**

```ts
// tools/recipes/src/cli/commands/shared.ts
import { formatEther } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import {
  identity,
  toAddressValue,
  toBigInt,
  toEth,
  toHexValue,
  toNumber,
  type RecipeCommand,
} from '../define';
import { addKeys } from '../../recipes/add-keys';
import { operatorInfo } from '../../recipes/operator-info';
import { deposit } from '../../recipes/deposit';
import { unvet, exit } from '../../recipes/vetting';
import { increaseAllocatedBalance, topUpActiveKeys } from '../../recipes/topup';
import { slash, withdraw } from '../../recipes/validators';
import {
  reportPenalty,
  cancelPenalty,
  settlePenalty,
  compensatePenalty,
} from '../../recipes/penalties';
import { addBond, createBondDebt } from '../../recipes/bond';
import {
  proposeManager,
  confirmManager,
  proposeReward,
  confirmReward,
} from '../../recipes/address-changes';
import { makeRewards, submitRewards } from '../../recipes/rewards';
import { clActivate } from '../../recipes/cl-activate';
import { getPubkey, getKeyBalance } from '../../recipes/reads';
import { warpBy, snapshot, revert } from '../../recipes/chain';

const operatorId = { flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true };
const keyIndex = { flag: '--key-index <i>', key: 'keyIndex', coerce: toBigInt, required: true };

export const sharedCommands: RecipeCommand[] = [
  {
    name: 'add-keys',
    summary: 'add N fresh validator keys to an operator (pays bond, as manager)',
    options: [
      operatorId,
      { flag: '--count <n>', key: 'count', coerce: toNumber, required: true },
      { flag: '--seed <hex>', key: 'seed', coerce: toHexValue },
    ],
    run: (ctx, o: { noId: bigint; count: number; seed?: Hex }) => addKeys(ctx, o),
    report: (r: { publicKeys: Hex[] }, o: { noId: bigint; count: number }) => [
      `operator ${o.noId}: +${o.count} keys`,
      `pubkeys: ${r.publicKeys.join(', ')}`,
    ],
  },
  {
    name: 'operator-info',
    summary: 'read a node operator record',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => operatorInfo(ctx, o),
    report: (r: Record<string, unknown>, o: { noId: bigint }) => [
      `operator ${o.noId}:`,
      ...Object.entries(r).map(([k, v]) => `  ${k}: ${String(v)}`),
    ],
  },
  {
    name: 'deposit',
    summary: 'deposit N depositable keys (as the StakingRouter)',
    options: [{ flag: '--count <n>', key: 'count', coerce: toBigInt, required: true }],
    run: (ctx, o: { count: bigint }) => deposit(ctx, o),
    report: (r: { deposited: bigint }) => [`deposited: ${r.deposited}`],
  },
  {
    name: 'unvet',
    summary: 'set an operator vetted-keys count down (as the StakingRouter)',
    options: [operatorId, { flag: '--vetted-keys <n>', key: 'vettedKeys', coerce: toBigInt, required: true }],
    run: (ctx, o: { noId: bigint; vettedKeys: bigint }) => unvet(ctx, o),
    report: (_r, o: { noId: bigint; vettedKeys: bigint }) => [`operator ${o.noId}: vetted=${o.vettedKeys}`],
  },
  {
    name: 'exit',
    summary: 'report exited keys for an operator (as the StakingRouter)',
    options: [operatorId, { flag: '--exited-keys <n>', key: 'exitedKeys', coerce: toBigInt, required: true }],
    run: (ctx, o: { noId: bigint; exitedKeys: bigint }) => exit(ctx, o),
    report: (_r, o: { noId: bigint; exitedKeys: bigint }) => [`operator ${o.noId}: exited=${o.exitedKeys}`],
  },
  {
    name: 'increase-allocated-balance',
    summary: 'top up one deposited key’s allocated balance (ETH)',
    options: [operatorId, keyIndex, { flag: '--amount <eth>', key: 'amountWei', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; amountWei: bigint }) => increaseAllocatedBalance(ctx, o),
    report: (r: { amountWei: bigint }) => [`+${formatEther(r.amountWei)} ETH allocated`],
  },
  {
    name: 'top-up-active-keys',
    summary: 'top up every active key of an operator (FIFO)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => topUpActiveKeys(ctx, o),
    report: (r: { toppedUp: number }) => [`topped up ${r.toppedUp} key(s)`],
  },
  {
    name: 'slash',
    summary: 'slash a validator key (Verifier-gated)',
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => slash(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint }) => [`slashed operator ${o.noId} key ${o.keyIndex}`],
  },
  {
    name: 'withdraw',
    summary: 'report a withdrawn validator (Verifier-gated); balances in ETH',
    options: [
      operatorId,
      keyIndex,
      { flag: '--exit-balance <eth>', key: 'exitBalance', coerce: toEth, required: true },
      { flag: '--slashing-penalty <eth>', key: 'slashingPenalty', coerce: toEth },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; exitBalance: bigint; slashingPenalty?: bigint }) =>
      withdraw(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint }) => [`withdrew operator ${o.noId} key ${o.keyIndex}`],
  },
  {
    name: 'report-penalty',
    summary: 'report a general delayed penalty (ETH amount)',
    options: [
      operatorId,
      { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true },
      { flag: '--penalty-type <hex>', key: 'penaltyType', coerce: toHexValue },
      { flag: '--details <text>', key: 'details', coerce: identity },
    ],
    run: (ctx, o: { noId: bigint; amount: bigint; penaltyType?: Hex; details?: string }) =>
      reportPenalty(ctx, o),
    report: (_r, o: { noId: bigint; amount: bigint }) => [
      `reported penalty ${formatEther(o.amount)} ETH on operator ${o.noId}`,
    ],
  },
  {
    name: 'cancel-penalty',
    summary: 'cancel a reported general delayed penalty (ETH amount)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => cancelPenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`cancelled penalty on operator ${o.noId}`],
  },
  {
    name: 'settle-penalty',
    summary: 'settle an operator’s general delayed penalty (optional ETH cap)',
    options: [operatorId, { flag: '--max-amount <eth>', key: 'maxAmount', coerce: toEth }],
    run: (ctx, o: { noId: bigint; maxAmount?: bigint }) => settlePenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`settled penalty on operator ${o.noId}`],
  },
  {
    name: 'compensate-penalty',
    summary: 'compensate (pay off) an operator’s penalty (as manager)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => compensatePenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`compensated penalty on operator ${o.noId}`],
  },
  {
    name: 'add-bond',
    summary: 'add bond to an operator (ETH)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => addBond(ctx, o),
    report: (_r, o: { noId: bigint; amount: bigint }) => [`added ${formatEther(o.amount)} ETH bond to operator ${o.noId}`],
  },
  {
    name: 'create-bond-debt',
    summary: 'create a bond debt by penalizing an operator (ETH)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => createBondDebt(ctx, o),
    report: (r: { penaltyCovered: boolean }, o: { noId: bigint }) => [
      `operator ${o.noId}: debt created (penaltyCovered=${r.penaltyCovered})`,
    ],
  },
  {
    name: 'propose-manager',
    summary: 'propose a new manager address (as current manager)',
    options: [operatorId, { flag: '--proposed <address>', key: 'proposed', coerce: toAddressValue, required: true }],
    run: (ctx, o: { noId: bigint; proposed: Hex }) => proposeManager(ctx, o),
    report: (_r, o: { noId: bigint; proposed: Hex }) => [`operator ${o.noId}: proposed manager ${o.proposed}`],
  },
  {
    name: 'confirm-manager',
    summary: 'confirm the proposed manager address (as proposed manager)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => confirmManager(ctx, o),
    report: (_r, o: { noId: bigint }) => [`operator ${o.noId}: manager confirmed`],
  },
  {
    name: 'propose-reward',
    summary: 'propose a new reward address (as current manager)',
    options: [operatorId, { flag: '--proposed <address>', key: 'proposed', coerce: toAddressValue, required: true }],
    run: (ctx, o: { noId: bigint; proposed: Hex }) => proposeReward(ctx, o),
    report: (_r, o: { noId: bigint; proposed: Hex }) => [`operator ${o.noId}: proposed reward ${o.proposed}`],
  },
  {
    name: 'confirm-reward',
    summary: 'confirm the proposed reward address (as proposed reward addr)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => confirmReward(ctx, o),
    report: (_r, o: { noId: bigint }) => [`operator ${o.noId}: reward confirmed`],
  },
  {
    name: 'make-rewards',
    summary: 'build the cumulative rewards tree + pin to IPFS (no submit)',
    options: [
      { flag: '--seed <hex>', key: 'seed', coerce: toHexValue },
      { flag: '--tree-cid <cid>', key: 'treeCid', coerce: identity },
      { flag: '--log-cid <cid>', key: 'logCid', coerce: identity },
    ],
    run: (ctx, o: { seed?: Hex; treeCid?: string; logCid?: string }) => makeRewards(ctx, o),
    report: (r: { treeRoot: Hex; treeCid: string; logCid: string; distributed: bigint }) => [
      `tree root: ${r.treeRoot}`,
      `tree CID:  ${r.treeCid || '(none)'}`,
      `log CID:   ${r.logCid || '(none)'}`,
      `distributed: ${formatEther(r.distributed)} ETH`,
    ],
  },
  {
    name: 'submit-rewards',
    summary: 'build AND submit a rewards report (warps to the next frame)',
    options: [
      { flag: '--seed <hex>', key: 'seed', coerce: toHexValue },
      { flag: '--tree-cid <cid>', key: 'treeCid', coerce: identity },
      { flag: '--log-cid <cid>', key: 'logCid', coerce: identity },
    ],
    run: async (ctx, o: { seed?: Hex; treeCid?: string; logCid?: string }) =>
      submitRewards(ctx, await makeRewards(ctx, o)),
    report: (r: { submitted: boolean; refSlot?: bigint; reportHash?: Hex }) =>
      r.submitted
        ? [`submitted at refSlot ${r.refSlot}`, `reportHash: ${r.reportHash}`]
        : ['skipped: empty report (zero root)'],
  },
  {
    name: 'cl-activate',
    summary: 'mark a key active_ongoing on a running cl-mock',
    needsClMock: true,
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => clActivate(ctx, o),
    report: (r: { pubkey: Hex; status: string; effectiveBalanceGwei: bigint }) => [
      `${r.pubkey}: ${r.status} @ ${r.effectiveBalanceGwei} gwei`,
    ],
  },
  {
    name: 'get-pubkey',
    summary: 'read a key’s pubkey',
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => getPubkey(ctx, o),
    report: (r: Hex) => [r],
  },
  {
    name: 'get-key-balance',
    summary: 'read a key’s allocated balance',
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => getKeyBalance(ctx, o),
    report: (r: bigint) => [`${formatEther(r)} ETH (${r} wei)`],
  },
  {
    name: 'warp',
    summary: 'advance the fork clock by N seconds',
    options: [{ flag: '--by <seconds>', key: 'by', coerce: toBigInt, required: true }],
    run: (ctx, o: { by: bigint }) => warpBy(ctx, o.by),
    report: (_r, o: { by: bigint }) => [`warped by ${o.by} seconds`],
  },
  {
    name: 'snapshot',
    summary: 'take an EVM snapshot, print its id',
    options: [],
    run: (ctx) => snapshot(ctx),
    report: (r: Hex) => [`snapshot id: ${r}`],
  },
  {
    name: 'revert',
    summary: 'revert the fork to a snapshot id',
    options: [{ flag: '--id <hex>', key: 'id', coerce: toHexValue, required: true }],
    run: (ctx, o: { id: Hex }) => revert(ctx, o.id),
    report: (_r, o: { id: Hex }) => [`reverted to ${o.id}`],
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/cli/commands/shared.ts tools/recipes/test/cli-shared.test.ts
git commit -m "feat(recipes): cli shared command descriptors"
```

---

### Task 3: cm + csm command descriptors

**Files:**
- Create: `tools/recipes/src/cli/commands/cm.ts`, `tools/recipes/src/cli/commands/csm.ts`
- Test: `tools/recipes/test/cli-modules.test.ts`

**Interfaces:**
- Consumes: coercers/types from `../define`; `createCuratedOperator`, `createOperatorGroup`, `resetOperatorGroup`, `setBondCurveWeight`, `seedCm` from `../../cm`; `setGateAddrs` from `../../csm`; `resolveGate` from `../../context`.
- Produces: `export const cmCommands: RecipeCommand[]` (module `'cm'`), `export const csmCommands: RecipeCommand[]` (module `'csm'`).

- [ ] **Step 1: Write the failing test**

```ts
// tools/recipes/test/cli-modules.test.ts
import { describe, expect, it } from 'vitest';
import { cmCommands } from '../src/cli/commands/cm';
import { csmCommands } from '../src/cli/commands/csm';

describe('cm/csm commands', () => {
  it('cm commands all force module cm', () => {
    expect(cmCommands.map((c) => c.name).toSorted()).toEqual(
      ['create-curated-operator', 'create-operator-group', 'reset-operator-group', 'seed', 'set-bond-curve-weight'].toSorted(),
    );
    expect(cmCommands.every((c) => c.module === 'cm')).toBe(true);
  });
  it('csm commands all force module csm', () => {
    expect(csmCommands.map((c) => c.name).toSorted()).toEqual(['resolve-gate', 'set-gate'].toSorted());
    expect(csmCommands.every((c) => c.module === 'csm')).toBe(true);
  });
  it('create-operator-group uses a repeatable --pair', () => {
    const g = cmCommands.find((c) => c.name === 'create-operator-group')!;
    const pair = g.options.find((o) => o.key === 'pairs')!;
    expect(pair.repeatable).toBe(true);
    expect(pair.coerce(['0:5000', '1:5000'])).toEqual([[0n, 5000n], [1n, 5000n]]);
  });
  it('resolve-gate reports the resolved address', () => {
    const rg = csmCommands.find((c) => c.name === 'resolve-gate')!;
    expect(rg.report('0xabc' as never, { selector: 'idvtc' })).toEqual(['idvtc → 0xabc']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-modules.test.ts`
Expected: FAIL — cannot resolve `../src/cli/commands/cm`.

- [ ] **Step 3: Write the implementations**

```ts
// tools/recipes/src/cli/commands/cm.ts
import type { Hex } from '@csm-lab/receipts';
import { identity, toAddressValue, toBigInt, toHexValue, toPairs, type RecipeCommand } from '../define';
import {
  createCuratedOperator,
  createOperatorGroup,
  resetOperatorGroup,
  setBondCurveWeight,
  seedCm,
} from '../../cm';

const operatorId = { flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true };

export const cmCommands: RecipeCommand[] = [
  {
    name: 'seed',
    summary: 'seed a realistic cm fork (3 operators, a group, keyed/deposited/topped-up)',
    module: 'cm',
    options: [
      { flag: '--selector <name>', key: 'selector', coerce: identity },
      { flag: '--seed <hex>', key: 'seed', coerce: toHexValue },
    ],
    run: (ctx, o: { selector?: string; seed?: Hex }) => seedCm(ctx, o),
    report: (r: { noIds: bigint[]; operators: Hex[] }) => [
      `seeded operators: ${r.noIds.join(', ')}`,
      `addresses: ${r.operators.join(', ')}`,
    ],
  },
  {
    name: 'create-curated-operator',
    summary: 'create a curated operator via a cm gate',
    module: 'cm',
    options: [
      { flag: '--selector <name>', key: 'selector', coerce: identity, required: true },
      { flag: '--operator <address>', key: 'operator', coerce: toAddressValue, required: true },
    ],
    run: (ctx, o: { selector: string; operator: Hex }) => createCuratedOperator(ctx, o),
    report: (r: { noId: bigint }) => [`created operator ${r.noId}`],
  },
  {
    name: 'create-operator-group',
    summary: 'create a MetaRegistry operator group (--pair noId:bps, must sum to 10000)',
    module: 'cm',
    options: [{ flag: '--pair <noId:bps>', key: 'pairs', coerce: toPairs, repeatable: true, required: true }],
    run: (ctx, o: { pairs: [bigint, bigint][] }) => createOperatorGroup(ctx, o),
    report: (r: { subNodeOperators: { nodeOperatorId: bigint; share: number }[]; resetGroupIds: bigint[] }) => [
      `group created: ${r.subNodeOperators.length} member(s)`,
      `members: ${r.subNodeOperators.map((s) => `${s.nodeOperatorId}@${s.share}bps`).join(', ')}`,
      ...(r.resetGroupIds.length ? [`reset prior groups: ${r.resetGroupIds.join(', ')}`] : []),
    ],
  },
  {
    name: 'reset-operator-group',
    summary: 'reset an operator’s group membership',
    module: 'cm',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => resetOperatorGroup(ctx, o),
    report: (_r, o: { noId: bigint }) => [`reset group for operator ${o.noId}`],
  },
  {
    name: 'set-bond-curve-weight',
    summary: 'set a bond curve weight',
    module: 'cm',
    options: [
      { flag: '--curve-id <n>', key: 'curveId', coerce: toBigInt, required: true },
      { flag: '--weight <n>', key: 'weight', coerce: toBigInt, required: true },
    ],
    run: (ctx, o: { curveId: bigint; weight: bigint }) => setBondCurveWeight(ctx, o),
    report: (r: { curveId: bigint; weight: bigint }) => [`curve ${r.curveId} weight=${r.weight}`],
  },
];
```

```ts
// tools/recipes/src/cli/commands/csm.ts
import type { Hex } from '@csm-lab/receipts';
import { identity, toAddresses, type RecipeCommand } from '../define';
import { resolveGate } from '../../context';
import { setGateAddrs } from '../../csm';

export const csmCommands: RecipeCommand[] = [
  {
    name: 'set-gate',
    summary: 'build + install a gate address tree (pins to IPFS unless --cid)',
    module: 'csm',
    options: [
      { flag: '--address <addr>', key: 'addresses', coerce: toAddresses, repeatable: true, required: true },
      { flag: '--selector <name>', key: 'selector', coerce: identity },
      { flag: '--cid <cid>', key: 'cid', coerce: identity },
    ],
    run: (ctx, o: { addresses: Hex[]; selector?: 'ics'; cid?: string }) => setGateAddrs(ctx, o),
    report: (r: { treeRoot: Hex; treeCid: string }) => [`tree root: ${r.treeRoot}`, `tree CID:  ${r.treeCid}`],
  },
  {
    name: 'resolve-gate',
    summary: 'resolve a gate address by selector (read-only)',
    module: 'csm',
    options: [{ flag: '--selector <name>', key: 'selector', coerce: identity, required: true }],
    run: (ctx, o: { selector: string }) => resolveGate(ctx, o.selector),
    report: (r: Hex, o: { selector: string }) => [`${o.selector} → ${r}`],
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-modules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/recipes/src/cli/commands/cm.ts tools/recipes/src/cli/commands/csm.ts tools/recipes/test/cli-modules.test.ts
git commit -m "feat(recipes): cli cm/csm command descriptors"
```

---

### Task 4: Program assembly, entrypoint, package wiring

**Files:**
- Create: `tools/recipes/src/cli/program.ts`, `tools/recipes/src/cli/index.ts`
- Modify: `tools/recipes/package.json`, `tools/recipes/tsdown.config.ts`
- Test: `tools/recipes/test/cli-program.test.ts`

**Interfaces:**
- Consumes: `defineCommand` from `./define`; `sharedCommands`, `cmCommands`, `csmCommands` from `./commands/*`; `connect` from `../context`.
- Produces: `buildProgram(connectImpl?): Command` (in `program.ts`). `index.ts` is the `#!/usr/bin/env node` shebang that loads dotenv and runs `buildProgram().parseAsync()`.

- [ ] **Step 1: Write the failing test**

```ts
// tools/recipes/test/cli-program.test.ts
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/program';

describe('buildProgram', () => {
  const p = buildProgram();
  it('registers global options', () => {
    const longs = p.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--rpc-url', '--module', '--cl-mock-url', '--json']));
  });
  it('registers all shared commands at the top level plus cm/csm groups', () => {
    const names = p.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['add-keys', 'make-rewards', 'cm', 'csm']));
  });
  it('the cm group nests its commands', () => {
    const cm = p.commands.find((c) => c.name() === 'cm')!;
    expect(cm.commands.map((c) => c.name())).toEqual(expect.arrayContaining(['seed', 'create-operator-group']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-program.test.ts`
Expected: FAIL — cannot resolve `../src/cli/program`.

- [ ] **Step 3: Write `program.ts`**

```ts
// tools/recipes/src/cli/program.ts
import { Command } from 'commander';
import { connect } from '../context';
import { defineCommand } from './define';
import { sharedCommands } from './commands/shared';
import { cmCommands } from './commands/cm';
import { csmCommands } from './commands/csm';

export function buildProgram(connectImpl: typeof connect = connect): Command {
  const program = new Command()
    .name('csm-recipes')
    .description('Prepare CSM on-chain state on an anvil fork (run-and-exit recipes)')
    .option('--rpc-url <url>', 'anvil fork RPC URL (default: $RPC_URL)')
    .option('--module <csm|cm>', 'target module for shared commands')
    .option('--cl-mock-url <url>', 'cl-mock URL for cl-activate (default: $CL_MOCK_URL)')
    .option('--json', 'emit the raw result as JSON')
    .addHelpCommand(false);

  for (const desc of sharedCommands) program.addCommand(defineCommand(desc, connectImpl));

  const cm = new Command('cm').description('cm-only recipes (module forced to cm)');
  for (const desc of cmCommands) cm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(cm);

  const csm = new Command('csm').description('csm-only recipes (module forced to csm)');
  for (const desc of csmCommands) csm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(csm);

  return program;
}
```

- [ ] **Step 4: Write `index.ts` (the bin entrypoint)**

```ts
// tools/recipes/src/cli/index.ts
#!/usr/bin/env node

// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { buildProgram } from './program';

buildProgram().parse();
```

- [ ] **Step 5: Wire `package.json`** — add `commander` + `dotenv` deps, `bin`, `start` script, bump version.

Add to `tools/recipes/package.json` (`dependencies`): `"commander": "catalog:"`, `"dotenv": "catalog:"`. Add top-level `"bin": { "csm-recipes": "dist/cli.mjs" }`. Add to `scripts`: `"start": "node dist/cli.mjs"`. Change `"version": "0.0.0"` → `"version": "0.1.0"`.

Verify `commander` and `dotenv` exist in `pnpm-workspace.yaml` `catalog:` (merkle already uses both); if `dotenv` is missing, add `dotenv: ^16.4.0` to the catalog. Then:

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 6: Wire `tsdown.config.ts`** — add the `cli` entry.

Edit `tools/recipes/tsdown.config.ts` `entry` to add `cli: 'src/cli/index.ts'`:

```ts
  entry: {
    index: 'src/index.ts',
    cm: 'src/cm/index.ts',
    csm: 'src/csm/index.ts',
    cli: 'src/cli/index.ts',
  },
```

- [ ] **Step 7: Run program test + build, verify the bin runs**

Run: `pnpm --filter @csm-lab/recipes exec vitest run test/cli-program.test.ts`
Expected: PASS.

Run: `pnpm --filter @csm-lab/recipes build && node tools/recipes/dist/cli.mjs --help`
Expected: help text listing shared commands + `cm`/`csm`; shebang present in `dist/cli.mjs` (first line `#!/usr/bin/env node`).

Run: `node tools/recipes/dist/cli.mjs cm --help`
Expected: lists `seed`, `create-operator-group`, etc.

- [ ] **Step 8: Commit**

```bash
git add tools/recipes/src/cli/program.ts tools/recipes/src/cli/index.ts tools/recipes/package.json tools/recipes/tsdown.config.ts tools/recipes/test/cli-program.test.ts pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(recipes): cli program assembly + bin wiring"
```

---

### Task 5: Docs, changeset, full gates

**Files:**
- Modify: `tools/recipes/README.md`
- Create: `.changeset/recipes-cli.md`

**Note on publishing:** This task wires the package for publish (bin, version, changeset) but does NOT run `npm publish`. The actual **coordinated first publish** of `@csm-lab/recipes` + `@csm-lab/merkle` + `@csm-lab/receipts` (none are on npm yet) is a follow-up release action via the changesets release flow / a maintainer — flagged here, not executed.

- [ ] **Step 1: Add a CLI section to `tools/recipes/README.md`**

Insert after the "Quick start" section:

````markdown
## CLI (`csm-recipes`)

A run-and-exit CLI over the recipe surface. Same `bin` underpins every route:

```bash
npx @csm-lab/recipes seed-cm --rpc-url http://127.0.0.1:8545   # published
npm i -g @csm-lab/recipes && csm-recipes --help                # global install
node tools/recipes/dist/cli.mjs --help                         # built dist (repo dev)
```

Global flags: `--rpc-url` (or `RPC_URL`), `--module <csm|cm>`, `--cl-mock-url` (or
`CL_MOCK_URL`), `--json`. Amounts (`--amount`, `--exit-balance`, …) are in **ETH**
(`0.000000000000000001` = 1 wei). cm-/csm-only recipes live under the `cm`/`csm` groups:

```bash
csm-recipes --module csm add-keys --operator-id 0 --count 3
csm-recipes --module csm make-rewards --json
csm-recipes cm seed --seed 0x01
csm-recipes csm set-gate --address 0xabc... --address 0xdef...
```
````

- [ ] **Step 2: Add the changeset**

```bash
cat > .changeset/recipes-cli.md <<'EOF'
---
'@csm-lab/recipes': minor
---

Add the `csm-recipes` CLI — a run-and-exit front-end over the recipe surface (declarative
command registry; shared commands plus `cm`/`csm` groups; ETH-denominated amounts; `--json`).
EOF
```

- [ ] **Step 3: Run the full per-package gates**

Run:
```bash
pnpm --filter @csm-lab/recipes build
pnpm --filter @csm-lab/recipes types
pnpm --filter @csm-lab/recipes test
pnpm exec oxlint tools/recipes
pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
```
Expected: all green. If prettier flags files, run `pnpm exec prettier --write "tools/recipes/**/*.{ts,json,md}"` and re-check.

- [ ] **Step 4: Commit**

```bash
git add tools/recipes/README.md .changeset/recipes-cli.md
git commit -m "docs(recipes): cli usage + changeset"
```

---

## Self-Review notes (for the implementer)

- If `types` fails on a `report`/`run` generic mismatch, the `RecipeCommand[]` array is typed loosely (`R = unknown`); cast the per-descriptor `run`/`report` parameter types inline as shown — do not weaken the recipe signatures.
- `optsWithGlobals()` requires commander ≥ 7; the catalog version (shared with cl-mock) satisfies this.
- `--no-*` flags are forbidden (commander negation) — the lint test in Task 2 guards this.
