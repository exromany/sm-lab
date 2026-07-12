# `add-gate` Recipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `add-gate` recipe + `sm-recipes add-gate` command that *appends* addresses to a gate's current merkle tree (preserving existing members), instead of replacing it the way `set-gate` does.

**Architecture:** `set-gate` (`setGateAddrs`) already builds → pins → installs a tree. `add-gate` (`addGateAddrs`) adds the missing *recover* half: read the gate's current `treeCid` (reusing `getGateTree`), fetch the pinned tree dump from IPFS (new `@sm-lab/merkle` read helpers), extract the current addresses, union with the new ones, then **delegate the install to `setGateAddrs`**. A no-op guard skips the write when nothing changed (the gate reverts on an unchanged root).

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), viem, `@openzeppelin/merkle-tree`, commander, Vitest. Packages: `@sm-lab/merkle` (tools/merkle), `@sm-lab/recipes` (tools/recipes).

## Global Constraints

- **ESM extensionless imports:** write `from './x'`, NOT `'./x.js'`. Use `import type` for type-only imports.
- **No DOM lib** (`lib: ["ES2023"]`): `fetch` returns `Response`, `res.json()` is `any`/`unknown` — cast explicitly (existing `ipfs.ts` / `cl-mock.ts` do `let res: Response` + `(await res.json()) as T`). Follow that.
- **`noUncheckedIndexedAccess` is on:** guard array access; in tests use `arr[0]!` (non-null) as the existing tests do.
- **Deps are pinned via pnpm `catalog:`** — no new deps are needed for this plan (viem, `@openzeppelin/merkle-tree` already present).
- **Lint/format:** oxlint (`.oxlintrc.json`) + prettier (single quotes, width 100, trailing commas). Prefer `Array#toSorted()` over `.sort()`.
- **Machine-readable I/O:** the CLI command takes `--json` automatically (via `defineCommand`); `report()` supplies the human lines. No manual `--json` wiring.
- **Changesets:** a changeset is required for this user-facing change (`access: public`; `core`/`config` are never published — not touched here).
- **Per-package done gates** (run from repo root): `pnpm --filter @sm-lab/<pkg> build` · `types` · `test` · `pnpm exec oxlint <dir>` · `pnpm exec prettier --check "<dir>/**/*.{ts,json}"`.

---

### Task 1: `@sm-lab/merkle` — `addressesFromDump` (pure inverse of the addresses tree)

**Files:**
- Modify: `tools/merkle/src/tree.ts` (add function)
- Modify: `tools/merkle/src/index.ts:6-13` (export it)
- Test: `tools/merkle/test/tree.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `buildAddressesTree`, `TreeDump` (already in `tree.ts`); `StandardMerkleTree` from `@openzeppelin/merkle-tree`.
- Produces: `addressesFromDump(dump: TreeDump): string[]` — recovers the address list from an addresses-tree dump.

- [ ] **Step 1: Write the failing test**

Add to `tools/merkle/test/tree.test.ts` (append; keep existing imports, add `addressesFromDump` to the import from `../src/tree`):

```ts
describe('addressesFromDump', () => {
  const A = '0x1111111111111111111111111111111111111111';
  const B = '0x2222222222222222222222222222222222222222';
  const C = '0x3333333333333333333333333333333333333333';

  it('round-trips the addresses of a buildAddressesTree dump', () => {
    const dump = buildAddressesTree([A, B, C]).dump();
    expect(addressesFromDump(dump).toSorted()).toEqual([A, B, C].toSorted());
  });

  it('returns an empty list for an empty dump', () => {
    const dump = buildAddressesTree([]).dump();
    expect(addressesFromDump(dump)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/merkle test -- tree`
Expected: FAIL — `addressesFromDump is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `tools/merkle/src/tree.ts`, add after `buildAddressesTree` (the file already imports `StandardMerkleTree`):

```ts
/**
 * Recover the address list from an addresses-tree dump — the inverse of
 * `buildAddressesTree(...).dump()`. Loads the OZ tree (which validates the dump shape) and reads
 * each single-value `['address']` leaf. Pure, no I/O. Used by recipes' `add-gate` to merge new
 * addresses into a gate's existing whitelist.
 */
export function addressesFromDump(dump: TreeDump): string[] {
  const tree = StandardMerkleTree.load(dump);
  const out: string[] = [];
  for (const [, leaf] of tree.entries()) {
    out.push((leaf as [string])[0]);
  }
  return out;
}
```

In `tools/merkle/src/index.ts`, add `addressesFromDump` to the existing `from './tree'` export block:

```ts
export {
  buildAddressesTree,
  buildStrikesTree,
  buildRewardsTree,
  addressesFromDump,
  ADDRESSES_LEAF_ENCODING,
  STRIKES_LEAF_ENCODING,
  REWARDS_LEAF_ENCODING,
} from './tree';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sm-lab/merkle test -- tree`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/merkle/src/tree.ts tools/merkle/src/index.ts tools/merkle/test/tree.test.ts
git commit -m "feat(merkle): addressesFromDump — recover addresses from a tree dump"
```

---

### Task 2: `@sm-lab/merkle` — `fetchIpfsJson` + `resolveIpfsGatewayUrl` (the missing read path)

**Files:**
- Modify: `tools/merkle/src/ipfs.ts` (add gateway resolver + reader)
- Modify: `tools/merkle/src/index.ts:27-38` (export them)
- Test: `tools/merkle/test/ipfs.test.ts` (add describe blocks)

**Interfaces:**
- Consumes: `resolveIpfsApiUrl`, `DEFAULT_IPFS_API_URL` (already in `ipfs.ts`).
- Produces:
  - `DEFAULT_IPFS_GATEWAY_URL = 'https://gateway.pinata.cloud'`
  - `resolveIpfsGatewayUrl(gatewayUrl?: string): string`
  - `interface FetchIpfsOptions { gatewayUrl?: string; skipHint?: string }`
  - `fetchIpfsJson(cid: string, opts?: FetchIpfsOptions): Promise<unknown>` — `GET {gateway}/ipfs/{cid}` → parsed JSON.

- [ ] **Step 1: Write the failing test**

Append to `tools/merkle/test/ipfs.test.ts` (the file already has `afterEach` unstubbing env + globals; add `fetchIpfsJson`, `resolveIpfsGatewayUrl`, `DEFAULT_IPFS_GATEWAY_URL` to the import from `../src/ipfs`):

```ts
describe('resolveIpfsGatewayUrl', () => {
  it('prefers an explicit argument (trailing slash stripped)', () => {
    expect(resolveIpfsGatewayUrl('http://localhost:9999/')).toBe('http://localhost:9999');
  });

  it('falls back to IPFS_GATEWAY_URL env', () => {
    vi.stubEnv('IPFS_GATEWAY_URL', 'http://gw:8080/');
    expect(resolveIpfsGatewayUrl()).toBe('http://gw:8080');
  });

  it('uses the pin origin when it is the local mock (serves pinning + /ipfs on one port)', () => {
    vi.stubEnv('IPFS_API_URL', '');
    vi.stubEnv('IPFS_GATEWAY_URL', '');
    vi.stubEnv('PINATA_JWT', '');
    vi.stubEnv('PINATA_API_KEY', '');
    vi.stubEnv('PINATA_API_SECRET', '');
    expect(resolveIpfsGatewayUrl()).toBe(LOCAL_IPFS_API_URL);
  });

  it('uses the public Pinata gateway when the pin origin is the Pinata API host', () => {
    vi.stubEnv('IPFS_API_URL', '');
    vi.stubEnv('IPFS_GATEWAY_URL', '');
    vi.stubEnv('PINATA_JWT', 'tok');
    expect(resolveIpfsGatewayUrl()).toBe(DEFAULT_IPFS_GATEWAY_URL);
  });
});

describe('fetchIpfsJson', () => {
  it('GETs {gateway}/ipfs/{cid} and returns the parsed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const json = await fetchIpfsJson('bafyCID', { gatewayUrl: 'http://gw' });
    expect(json).toEqual({ hello: 'world' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://gw/ipfs/bafyCID');
  });

  it('throws an actionable error (gateway + skipHint) when the gateway is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      fetchIpfsJson('bafyCID', { gatewayUrl: 'http://gw', skipHint: 'pass --from-cid <cid>' }),
    ).rejects.toThrow(/cannot reach the IPFS gateway at http:\/\/gw[\s\S]*--from-cid/);
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' })),
    );
    await expect(fetchIpfsJson('bafyCID', { gatewayUrl: 'http://gw' })).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/merkle test -- ipfs`
Expected: FAIL — `fetchIpfsJson`/`resolveIpfsGatewayUrl` not exported.

- [ ] **Step 3: Write minimal implementation**

In `tools/merkle/src/ipfs.ts`, add after the `LOCAL_IPFS_API_URL` const (top region) and the resolver near `resolveIpfsApiUrl`:

```ts
/** Real Pinata public gateway — the read fallback when the pin origin is the Pinata API host. */
export const DEFAULT_IPFS_GATEWAY_URL = 'https://gateway.pinata.cloud';
```

and, after `resolveIpfsApiUrl`:

```ts
/**
 * Resolve the base URL for IPFS *reads* (`GET /ipfs/:cid`): explicit `gatewayUrl` →
 * `IPFS_GATEWAY_URL` env → the pin origin (`resolveIpfsApiUrl` — exactly right for the local
 * `@sm-lab/ipfs` mock, which serves pinning AND `/ipfs/:cid` on one port) → the public Pinata
 * gateway when the pin origin is the Pinata API host (`api.pinata.cloud` does NOT serve `/ipfs`).
 */
export function resolveIpfsGatewayUrl(gatewayUrl?: string): string {
  const explicit = gatewayUrl || process.env.IPFS_GATEWAY_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const pin = resolveIpfsApiUrl();
  return pin === DEFAULT_IPFS_API_URL ? DEFAULT_IPFS_GATEWAY_URL : pin;
}

export interface FetchIpfsOptions {
  /** Gateway base URL. Defaults per {@link resolveIpfsGatewayUrl}. */
  gatewayUrl?: string;
  /** Caller's bypass hint woven into the unreachable error (e.g. `'pass --from-cid <cid>'`). */
  skipHint?: string;
}

/**
 * Fetch + JSON-parse a pinned object by CID via `GET {gateway}/ipfs/{cid}`. The read counterpart
 * of {@link pinJsonToIpfs}, mirroring its discipline: trailing-slash-stripped join, explicit
 * `Response` typing (no DOM lib), and an actionable throw. A thrown fetch (connection refused /
 * DNS / timeout) or a non-2xx surfaces an error naming the gateway + the caller's `skipHint`.
 */
export async function fetchIpfsJson(cid: string, opts: FetchIpfsOptions = {}): Promise<unknown> {
  const base = resolveIpfsGatewayUrl(opts.gatewayUrl);
  const url = `${base}/ipfs/${cid}`;
  const hint = opts.skipHint ?? 'supply the addresses another way';
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      `@sm-lab/merkle: cannot reach the IPFS gateway at ${base} to read ${cid}.\n` +
        `Do one of:\n` +
        `  • start the local mock:  npx @sm-lab/ipfs serve      (or: pnpm stack:up)\n` +
        `  • point elsewhere:       set IPFS_GATEWAY_URL=<url>\n` +
        `  • ${hint}`,
    );
  }
  if (!res.ok) {
    throw new Error(`@sm-lab/merkle: GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as unknown;
}
```

In `tools/merkle/src/index.ts`, extend the `from './ipfs'` export block with the three new names and the type:

```ts
export {
  pinJsonToIpfs,
  fetchIpfsJson,
  hasPinataCredentials,
  hasCustomIpfsEndpoint,
  shouldAttemptPin,
  assertPinnable,
  resolveIpfsApiUrl,
  resolveIpfsGatewayUrl,
  ipfsOptionsFromEnv,
  DEFAULT_IPFS_API_URL,
  DEFAULT_IPFS_GATEWAY_URL,
  LOCAL_IPFS_API_URL,
} from './ipfs';
export type { IpfsClientOptions, PinResponse, FetchIpfsOptions } from './ipfs';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sm-lab/merkle test -- ipfs`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

```bash
pnpm --filter @sm-lab/merkle build && pnpm --filter @sm-lab/merkle types && pnpm --filter @sm-lab/merkle test
pnpm exec oxlint tools/merkle && pnpm exec prettier --check "tools/merkle/**/*.{ts,json}"
git add tools/merkle/src/ipfs.ts tools/merkle/src/index.ts tools/merkle/test/ipfs.test.ts
git commit -m "feat(merkle): fetchIpfsJson + resolveIpfsGatewayUrl — IPFS read path"
```

---

### Task 3: `@sm-lab/recipes` — `addGateAddrs` recipe

**Files:**
- Modify: `tools/recipes/src/recipes/set-gate.ts:31-33` (export `defaultSelector`)
- Create: `tools/recipes/src/recipes/add-gate.ts`
- Modify: `tools/recipes/src/index.ts:52-53` (export the recipe + types)
- Test: `tools/recipes/test/add-gate.test.ts`

**Interfaces:**
- Consumes: `addressesFromDump`, `buildAddressesTree`, `fetchIpfsJson`, `TreeDump` from `@sm-lab/merkle` (Tasks 1-2); `getGateTree` from `./reads`; `setGateAddrs` + `defaultSelector` from `./set-gate`; `getAddress` from `viem`; `Ctx`, `GateSelector` from `../context`.
- Produces:
  - `interface AddGateAddrsOptions { addresses: Hex[]; selector?: GateSelector | string; fromCid?: string; cid?: string }`
  - `interface AddGateAddrsResult { treeRoot: Hex; treeCid: string; added: Hex[]; changed: boolean }`
  - `addGateAddrs(ctx: Ctx, opts: AddGateAddrsOptions): Promise<AddGateAddrsResult>`

- [ ] **Step 1: Export `defaultSelector` from `set-gate.ts`**

In `tools/recipes/src/recipes/set-gate.ts`, change the private helper to an export (leave the body unchanged):

```ts
/** Default gate selector per module: cm → 'po' (CuratedGatePO); csm → 'ics' (IcsGate). */
export function defaultSelector(ctx: Ctx): string {
  return ctx.module === 'cm' ? 'po' : 'ics';
}
```

- [ ] **Step 2: Write the failing test**

Create `tools/recipes/test/add-gate.test.ts`:

```ts
import { buildAddressesTree } from '@sm-lab/merkle';
import { getAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGateAddrs } from '../src/recipes/add-gate';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const dumpResponse = (addrs: string[]): Response =>
  new Response(JSON.stringify(buildAddressesTree(addrs).dump()), { status: 200 });

const clearIpfsEnv = (): void => {
  delete process.env.IPFS_API_URL;
  delete process.env.IPFS_GATEWAY_URL;
  delete process.env.PINATA_JWT;
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_API_SECRET;
};

describe('addGateAddrs', () => {
  beforeEach(clearIpfsEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIpfsEnv();
  });

  it('reads the current tree from IPFS, unions the new address, and re-installs it (csm)', async () => {
    const ADMIN = A(0xd0);
    const GATE = A(0x0d); // IcsGate (ics default)
    const current = [A(0x11), A(0x12)];
    const fetchMock = vi.fn().mockResolvedValue(dumpResponse(current));
    vi.stubGlobal('fetch', fetchMock);

    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: ADMIN, treeCid: 'cur-cid' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: GATE });

    const res = await addGateAddrs(ctx, { addresses: [A(0x13)], cid: 'new-cid' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:5001/ipfs/cur-cid');

    const union = [A(0x11), A(0x12), A(0x13)];
    expect(res.treeRoot).toBe(buildAddressesTree(union).root);
    expect(res.treeCid).toBe('new-cid');
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([getAddress(A(0x13))]);

    const set = (byMethod('writeContract') as any[]).find((w) => w.functionName === 'setTreeParams');
    expect(set.address).toBe(GATE);
    expect(set.args).toEqual([buildAddressesTree(union).root, 'new-cid']);
    expect(set.account).toBe(ADMIN);
  });

  it('is a no-op (no writes) when every new address is already whitelisted', async () => {
    const current = [A(0x11), A(0x12)];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dumpResponse(current)));
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: 'cur-cid' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    const res = await addGateAddrs(ctx, { addresses: [A(0x11)], cid: 'ignored' });

    expect(res.changed).toBe(false);
    expect(res.added).toEqual([]);
    expect(res.treeCid).toBe('cur-cid');
    expect(res.treeRoot).toBe(buildAddressesTree(current).root);
    expect(byMethod('writeContract')).toHaveLength(0); // no grantRole, no setTreeParams
  });

  it('treats a fresh gate (empty treeCid) as an empty set — no IPFS read; installs the new set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: '' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    const res = await addGateAddrs(ctx, { addresses: [A(0x11)], cid: 'new-cid' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([getAddress(A(0x11))]);
    const set = (byMethod('writeContract') as any[]).find((w) => w.functionName === 'setTreeParams');
    expect(set.args).toEqual([buildAddressesTree([A(0x11)]).root, 'new-cid']);
  });

  it('--from-cid bypasses the on-chain treeCid() read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(dumpResponse([A(0x11)]));
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: A(0xd0) } });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    await addGateAddrs(ctx, { addresses: [A(0x12)], fromCid: 'explicit-cid', cid: 'new-cid' });

    const readNames = (byMethod('readContract') as any[]).map((r) => r.functionName);
    expect(readNames).not.toContain('treeCid');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:5001/ipfs/explicit-cid');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @sm-lab/recipes test -- add-gate`
Expected: FAIL — cannot resolve `../src/recipes/add-gate`.

- [ ] **Step 4: Write minimal implementation**

Create `tools/recipes/src/recipes/add-gate.ts`:

```ts
import { addressesFromDump, buildAddressesTree, fetchIpfsJson, type TreeDump } from '@sm-lab/merkle';
import type { Hex } from '@sm-lab/receipts';
import { getAddress } from 'viem';
import type { Ctx, GateSelector } from '../context';
import { getGateTree } from './reads';
import { defaultSelector, setGateAddrs } from './set-gate';

export interface AddGateAddrsOptions {
  /** Addresses to append to the gate's current whitelist. */
  addresses: Hex[];
  /** Gate selector (same semantics as set-gate). Defaults per module: cm → 'po', csm → 'ics'. */
  selector?: GateSelector | string;
  /** Read the current tree from this CID instead of the gate's on-chain `treeCid()`. */
  fromCid?: string;
  /** Skip pinning the merged tree by supplying its CID (also the hermetic-test bypass). */
  cid?: string;
}

export interface AddGateAddrsResult {
  treeRoot: Hex;
  treeCid: string;
  /** Addresses actually newly added (checksummed) — empty when all were already present. */
  added: Hex[];
  /** false when every new address was already whitelisted (no on-chain write performed). */
  changed: boolean;
}

/**
 * Append addresses to a gate's current merkle tree, preserving the existing members — the additive
 * counterpart of `setGateAddrs` (which replaces the whole tree). Flow: recover the current set
 * (gate `treeCid` → IPFS dump), union with the new addresses (case-insensitive dedup, checksummed
 * out), then delegate build+pin+install to `setGateAddrs`.
 *
 * No-op guard: if every new address is already whitelisted the union is unchanged, so the root is
 * unchanged — and the gate's `setTreeParams` reverts on an unchanged root. We detect that and
 * return `{ changed: false }` without any write. The unchanged root is recomputed locally
 * (`buildAddressesTree(union).root`); OZ trees are order-independent and every gate tree in this
 * lab is built by `buildAddressesTree`, so it equals the on-chain root — no extra `treeRoot()` read.
 */
export async function addGateAddrs(
  ctx: Ctx,
  opts: AddGateAddrsOptions,
): Promise<AddGateAddrsResult> {
  const selector = opts.selector ?? defaultSelector(ctx);
  const curCid = opts.fromCid ?? (await getGateTree(ctx, { selector })).treeCid;
  const current = curCid
    ? addressesFromDump((await fetchIpfsJson(curCid, { skipHint: 'pass --from-cid <cid>' })) as TreeDump)
    : [];

  // Case-insensitive dedup keyed by lowercase, values kept checksummed.
  const union = new Map<string, Hex>();
  for (const a of current) union.set(a.toLowerCase(), getAddress(a));
  const added: Hex[] = [];
  for (const a of opts.addresses) {
    const cs = getAddress(a);
    const key = cs.toLowerCase();
    if (!union.has(key)) {
      union.set(key, cs);
      added.push(cs);
    }
  }
  const addresses = [...union.values()].toSorted();

  if (added.length === 0) {
    return {
      treeRoot: buildAddressesTree(addresses).root as Hex,
      treeCid: curCid,
      added: [],
      changed: false,
    };
  }

  const { treeRoot, treeCid } = await setGateAddrs(ctx, { addresses, selector, cid: opts.cid });
  return { treeRoot, treeCid, added, changed: true };
}
```

In `tools/recipes/src/index.ts`, add below the `setGateAddrs` exports (line 52-53):

```ts
export { addGateAddrs } from './recipes/add-gate';
export type { AddGateAddrsOptions, AddGateAddrsResult } from './recipes/add-gate';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @sm-lab/recipes test -- add-gate`
Expected: PASS (all 4 cases).

- [ ] **Step 6: Commit**

```bash
git add tools/recipes/src/recipes/add-gate.ts tools/recipes/src/recipes/set-gate.ts tools/recipes/src/index.ts tools/recipes/test/add-gate.test.ts
git commit -m "feat(recipes): addGateAddrs — append addresses to a gate's current tree"
```

---

### Task 4: CLI `add-gate` command (csm + cm) + tests + changeset

**Files:**
- Modify: `tools/recipes/src/cli/commands/csm.ts` (import + descriptor)
- Modify: `tools/recipes/src/cli/commands/cm.ts` (import + descriptor)
- Modify: `tools/recipes/test/cli-modules.test.ts` (expected command sets + positional shape)
- Modify: `tools/recipes/test/cli-program.test.ts:94-98` (add `toContain('add-gate')`)
- Create: `.changeset/add-gate-recipe.md`

**Interfaces:**
- Consumes: `addGateAddrs` (Task 3); `identity`, `toAddresses`, `RecipeCommand` from `../define`.
- Produces: an `add-gate` `RecipeCommand` in both `csmCommands` and `cmCommands`.

- [ ] **Step 1: Update the failing descriptor tests**

In `tools/recipes/test/cli-modules.test.ts`, add `'add-gate'` to both expected arrays:

```ts
// cm block:
expect(cmCommands.map((c) => c.name).toSorted()).toEqual(
  [
    'add-gate',
    'create-curated-operator',
    'create-operator-group',
    'reset-operator-group',
    'resolve-gate',
    'seed',
    'set-bond-curve-weight',
    'set-gate',
  ].toSorted(),
);
```

```ts
// csm block:
expect(csmCommands.map((c) => c.name).toSorted()).toEqual(
  ['add-gate', 'resolve-gate', 'set-gate'].toSorted(),
);
```

Add a positional-shape test (after the existing `set-gate accepts <selector>…` test):

```ts
it('add-gate accepts <selector> then a variadic <address...> positionally', () => {
  const ag = csmCommands.find((c) => c.name === 'add-gate')!;
  const args = defineCommand(ag).registeredArguments;
  expect(args.map((a) => a.name())).toEqual(['selector', 'address']);
  expect(args.map((a) => a.variadic)).toEqual([false, true]);
});
```

In `tools/recipes/test/cli-program.test.ts`, in the gate-commands assertion block (around line 94-98), add:

```ts
expect(csmNames).toContain('add-gate');
expect(cmNames).toContain('add-gate');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sm-lab/recipes test -- cli-modules cli-program`
Expected: FAIL — arrays don't contain `add-gate`; `add-gate` descriptor not found (`.find(...)!` → undefined).

- [ ] **Step 3: Add the csm descriptor**

In `tools/recipes/src/cli/commands/csm.ts`, add the import (below the `setGateAddrs` import):

```ts
import { addGateAddrs } from '../../recipes/add-gate';
```

Add this descriptor to the `csmCommands` array (e.g. right after `set-gate`):

```ts
{
  name: 'add-gate',
  summary: "append addresses to the gate's current tree (reads current set from IPFS, re-pins)",
  module: 'csm',
  // Positional form mirrors set-gate: selector, then the variadic addresses:
  //   `add-gate idvtc 0xabc…` == `add-gate --selector idvtc --address 0xabc…`
  options: [
    {
      flag: '--selector <name>',
      key: 'selector',
      coerce: identity,
      positional: true,
      description: `${csmSelectorHelp} (default: ics)`,
    },
    {
      flag: '--address <addr>',
      key: 'addresses',
      coerce: toAddresses,
      repeatable: true,
      required: true,
      positional: true,
    },
    {
      flag: '--from-cid <cid>',
      key: 'fromCid',
      coerce: identity,
      description: "read the current tree from this CID instead of the gate's treeCid()",
    },
    {
      flag: '--cid <cid>',
      key: 'cid',
      coerce: identity,
      description: 'skip IPFS pinning of the merged tree by supplying its CID',
    },
  ],
  run: (ctx, o: { addresses: Hex[]; selector?: string; fromCid?: string; cid?: string }) =>
    addGateAddrs(ctx, o),
  report: (r: { treeRoot: Hex; treeCid: string; added: Hex[]; changed: boolean }) => [
    `tree root: ${r.treeRoot}`,
    `tree CID:  ${r.treeCid}`,
    r.changed
      ? `added ${r.added.length} address(es): ${r.added.join(', ')}`
      : 'no change — all already whitelisted',
  ],
},
```

- [ ] **Step 4: Add the cm descriptor**

In `tools/recipes/src/cli/commands/cm.ts`, add the import (below the `setGateAddrs` import):

```ts
import { addGateAddrs } from '../../recipes/add-gate';
```

Add this descriptor to the `cmCommands` array (right after `set-gate`). It is identical to the csm one except `module: 'cm'`, the `cmSelectorHelp` text, and the `(default: po)` hint:

```ts
{
  name: 'add-gate',
  summary: "append addresses to the gate's current tree (reads current set from IPFS, re-pins)",
  module: 'cm',
  //   `cm add-gate pto 0xabc…` == `cm add-gate --selector pto --address 0xabc…`
  options: [
    {
      flag: '--selector <name>',
      key: 'selector',
      coerce: identity,
      positional: true,
      description: `${cmSelectorHelp} (default: po)`,
    },
    {
      flag: '--address <addr>',
      key: 'addresses',
      coerce: toAddresses,
      repeatable: true,
      required: true,
      positional: true,
    },
    {
      flag: '--from-cid <cid>',
      key: 'fromCid',
      coerce: identity,
      description: "read the current tree from this CID instead of the gate's treeCid()",
    },
    {
      flag: '--cid <cid>',
      key: 'cid',
      coerce: identity,
      description: 'skip IPFS pinning of the merged tree by supplying its CID',
    },
  ],
  run: (ctx, o: { addresses: Hex[]; selector?: string; fromCid?: string; cid?: string }) =>
    addGateAddrs(ctx, o),
  report: (r: { treeRoot: Hex; treeCid: string; added: Hex[]; changed: boolean }) => [
    `tree root: ${r.treeRoot}`,
    `tree CID:  ${r.treeCid}`,
    r.changed
      ? `added ${r.added.length} address(es): ${r.added.join(', ')}`
      : 'no change — all already whitelisted',
  ],
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sm-lab/recipes test -- cli-modules cli-program`
Expected: PASS.

- [ ] **Step 6: Add the changeset**

Create `.changeset/add-gate-recipe.md`:

```markdown
---
'@sm-lab/merkle': minor
'@sm-lab/recipes': minor
---

Add an `add-gate` recipe + `sm-recipes add-gate` command that *appends* addresses to a gate's
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
```

- [ ] **Step 7: Full gate for both packages + commit**

```bash
pnpm --filter @sm-lab/merkle build && pnpm --filter @sm-lab/recipes build
pnpm --filter @sm-lab/recipes types && pnpm --filter @sm-lab/recipes test
pnpm exec oxlint tools/recipes && pnpm exec prettier --check "tools/recipes/**/*.{ts,json}"
git add tools/recipes/src/cli/commands/csm.ts tools/recipes/src/cli/commands/cm.ts \
        tools/recipes/test/cli-modules.test.ts tools/recipes/test/cli-program.test.ts \
        .changeset/add-gate-recipe.md
git commit -m "feat(recipes): add-gate CLI command (csm + cm) + changeset"
```

---

## Self-Review

**1. Spec coverage:**
- Flow (recover → union → delegate) → Task 3. ✓
- No-op guard (unchanged-root revert) → Task 3 impl + test case 2. ✓
- `fetchIpfsJson` + gateway resolver → Task 2. ✓
- `addressesFromDump` → Task 1. ✓
- CLI `add-gate` mirrored csm+cm with `--from-cid`/`--cid` + positional shape → Task 4. ✓
- Escape hatches (`--from-cid`, `--cid`, empty-gate) → Task 3 impl + test cases 3-4. ✓
- `--json`/report → Task 4 descriptor `report()`. ✓
- Case-insensitive dedup, checksummed output → Task 3 impl + assertions on `res.added`. ✓
- Delegate install to `setGateAddrs` (no duplicated impersonation) → Task 3 impl. ✓
- Hermetic tests (fake client reads + fetch stub) → Tasks 1-4. ✓
- Changeset → Task 4 Step 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected result. ✓

**3. Type consistency:** `addGateAddrs`/`AddGateAddrsOptions`/`AddGateAddrsResult`, `fetchIpfsJson`/`FetchIpfsOptions`, `resolveIpfsGatewayUrl`, `addressesFromDump`, `defaultSelector` are named identically across the recipe, the CLI descriptors, the tests, and the index exports. The CLI `run` opts type (`{ addresses; selector?; fromCid?; cid? }`) matches `AddGateAddrsOptions`. ✓

## Notes for the implementer

- **Why reuse `getGateTree` (not a raw `treeCid()` read):** it already reads `{ treeRoot, treeCid }` off the correct per-module gate ABI (`reads.ts:142`). Its extra `treeRoot` read is harmless; the fake client returns `undefined` for unspecified reads.
- **Why the root is checksum-agnostic:** OZ `StandardMerkleTree.of([[addr]], ['address'])` ABI-encodes the address to its 20-byte value, so `buildAddressesTree(lowercase).root === buildAddressesTree(checksummed).root`. That's why the tests compute expected roots with the lowercase `A(n)` fixtures even though the recipe passes checksummed addresses.
- **Running a single test file:** `pnpm --filter @sm-lab/<pkg> test -- <name-substring>` (Vitest filters by filename).
