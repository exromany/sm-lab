# `add-gate` — append addresses to the current gate tree

**Date:** 2026-07-12
**Status:** design
**Type:** new recipe + one merkle read primitive
**Blast radius:** `tools/recipes` (new recipe + CLI), `tools/merkle` (new IPFS-read helper)

## Context

`set-gate` (`setGateAddrs`) builds a fresh OZ `['address']` merkle tree from **only** the passed
addresses, pins the tree dump to IPFS, and calls `setTreeParams(root, cid)` on the gate under admin
impersonation — **fully replacing** the previous whitelist. There is no way to grow an existing
allowlist without re-supplying every current member.

We add `add-gate`: append one or more addresses to whatever the gate holds today, preserving the
existing members.

### Why this needs IPFS reads

The gate stores only `treeRoot` + `treeCid`. A merkle root is one-way — you cannot enumerate the
whitelisted addresses from `treeRoot()`. The **only** place the full set survives is the OZ tree
dump pinned to IPFS, referenced by `treeCid()`. So "add to the current tree" is:

> recover the current set (chain → `treeCid` → IPFS dump) → union with the new address(es) →
> rebuild → re-pin → re-install.

Every step except the recover-half is already implemented by `setGateAddrs`, so the new recipe is
thin and **delegates the install half to `setGateAddrs`**.

## Flow

```
addGateAddrs(ctx, { addresses: new[], selector?, fromCid?, cid? })
  1. selector  = opts.selector ?? defaultSelector(ctx)         # 'po' (cm) | 'ics' (csm)
  2. gate      = resolveGate(ctx, selector)                    # reuse
  3. curCid    = fromCid ?? gate.treeCid()                     # on-chain read
  4. current   = curCid ? addressesFromDump(fetchIpfsJson(curCid)) : []   # empty/unset → []
  5. union     = dedupe(current ∪ new)                         # case-insensitive, checksummed out
  6. if union ≡ current → return { changed:false, treeRoot:buildAddressesTree(union).root, treeCid:curCid, added:[] }
  7. return { ...setGateAddrs(ctx, { addresses: union, selector, cid }), added, changed:true }
```

### Correctness point — the no-op guard (step 6)

The gate's `setTreeParams` **reverts on an unchanged root** (documented in the 6b plan). If every
new address is already whitelisted, the union equals the current set, the root is unchanged, and a
blind delegate to `setGateAddrs` would revert on-chain. `addGateAddrs` therefore compares the union
against the current set and, when nothing changed, returns early **without any write**, reporting
`changed: false`. The unchanged root is recomputed locally as `buildAddressesTree(union).root` (OZ
trees are order-independent and every gate tree in this lab is built by `buildAddressesTree`, so it
equals the on-chain root) — no extra `treeRoot()` read needed. This guard lives in `addGateAddrs`,
not `setGateAddrs` (set-gate is always a full
replacement; its unchanged-edge is out of scope here).

## New pieces

### `@sm-lab/merkle` — the missing read primitive

merkle can pin (`pinJsonToIpfs`) but has no read path. Add, mirroring the pin helper's discipline
(trailing-slash-stripped join, explicit response cast — no DOM lib, actionable throws):

- **`fetchIpfsJson(cid, opts?): Promise<unknown>`** — `GET {gateway}/ipfs/{cid}`. Gateway base URL
  resolves: explicit `opts.gatewayUrl` → `IPFS_GATEWAY_URL` env → `resolveIpfsApiUrl()` (the pin
  origin — exactly right for the local `@sm-lab/ipfs` mock, which serves pinning **and** `/ipfs/:cid`
  on one port) → Pinata public gateway (`https://gateway.pinata.cloud`) as the last resort. A thrown
  fetch (connection refused) or non-2xx surfaces an actionable error naming the gateway and the
  `--from-cid` escape.
- **`addressesFromDump(dump): string[]`** — pure. `StandardMerkleTree.load(dump)` → iterate
  `tree.entries()` → the single `['address']` leaf value each. No I/O, unit-testable against a
  fixture dump.

Both exported from `tools/merkle/src/index.ts`.

### `tools/recipes/src/recipes/add-gate.ts`

```ts
export interface AddGateAddrsOptions {
  addresses: Hex[];          // new addresses to append
  selector?: GateSelector | string;
  fromCid?: string;          // override the current-tree cid (skip the treeCid() read)
  cid?: string;              // skip pinning the merged result (also the hermetic-test bypass)
}
export interface AddGateAddrsResult {
  treeRoot: Hex;
  treeCid: string;
  added: Hex[];              // addresses actually newly added (union minus current)
  changed: boolean;          // false when every new address was already whitelisted
}
export async function addGateAddrs(ctx, opts): Promise<AddGateAddrsResult>
```

Dedup: normalize every address via viem `getAddress` (checksum), dedup on the lowercase form,
emit checksummed. OZ sorts leaves internally, so union order never affects the root.

Exported from `tools/recipes/src/index.ts` alongside `setGateAddrs`.

### CLI — `add-gate` command

Mirrored in both `csm.ts` and `cm.ts`, identical positional shape to `set-gate`
(`add-gate <selector> <addr...>`), plus:

- `--from-cid <cid>` — current-tree dump override.
- `--cid <cid>` — skip pinning the merged result.

Report (human): `tree root: …`, `tree CID: …`, and either `added N address(es)` or
`no change — all already whitelisted`. `--json` emits the full `AddGateAddrsResult`
(per the repo's machine-readable I/O contract; `Hex[]` serialize as-is).

## Escape hatches (recap)

| Hatch                | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `--from-cid <cid>`   | Skip the `treeCid()` read; point at a known current dump (Pinata / offline). |
| `--cid <cid>`        | Skip pinning the merged result (same meaning as set-gate; hermetic-test bypass). |
| empty/unset gate cid | Treated as empty current set → `add-gate` on a fresh gate == `set-gate`. |

## Testing (hermetic)

`makeFakeClient({ reads: { treeCid, getRoleMember } })` fakes the chain reads; stub global
`fetch` to serve a canned tree dump for the `/ipfs/{cid}` read (the pattern set-gate's last test
already uses). Cases:

1. **appends & dedups** — new + existing addresses → union tree installed; `added` lists only the
   genuinely-new ones.
2. **no-op** — every new address already present → asserts **no** `setTreeParams` write and
   `changed: false`.
3. **fresh gate** — empty `treeCid` → skips the fetch, behaves like `set-gate` (installs the new set).
4. **`--from-cid`** — bypasses the `treeCid()` read, fetches the supplied cid instead.
5. **merkle unit** — `addressesFromDump(dump)` round-trips the addresses of a `buildAddressesTree`
   dump; `fetchIpfsJson` throws actionably when the gateway is unreachable.

## Decisions settled

- **Delegate the install to `setGateAddrs`** — no duplicated grantRole/setTreeParams/impersonation.
- **Case-insensitive dedup, checksummed output.**
- **No-op guard in `addGateAddrs`** to avoid the unchanged-root revert.
- Command name `add-gate`, mirrored per-module like `set-gate`.

## Out of scope

- A `remove-gate` / prune recipe (revoke an address). Symmetric but not requested.
- Faithful Pinata gateway auth for private dumps — the mock/local flow and public gateway cover the
  lab's use; `--from-cid` + `IPFS_GATEWAY_URL` are the escape for anything else.
