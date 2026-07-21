# `csm create-operator` — create a CSM node operator through a gate

**Date:** 2026-07-21
**Status:** design
**Type:** new recipe + CLI command + two small framework extensions
**Blast radius:** `tools/recipes` (new recipe, `add-gate` result extension, `define.ts` extensions,
CLI command), no other packages.

## Context

The lab has no way to create a **csm** node operator — only cm has `createCuratedOperator`. In CSM
the operator's "type" is not a field: it is the **gate you create through**, which pins the bond
curve at creation. Three entry gates exist in the address book:

- `PermissionlessGate` — open entry, default curve, no proof (`addNodeOperatorETH` has no proof
  param, `CURVE_ID()` view);
- `IcsGate` (`ics`) / `IdvtcGate` (`idvtc`, v3-only) — `VettedGate` instances: `addNodeOperatorETH`
  takes a `bytes32[] proof` against the gate's allowlist merkle tree, `curveId()` view, one
  creation per address (`isConsumed`), pausable.

Creation **requires at least one validator key** in the same call (keysCount ≥ 1, keys + BLS
signatures packed) plus the ETH bond for those keys.

## Decisions (user-confirmed)

1. **No selector → PermissionlessGate.** Passing `ics`/`idvtc` (or a raw `0x…` gate address)
   switches to the vetted path and supplies the proof.
2. **Gated path uses persistent `add-gate`**, not the cm temp-tree trick: the address is appended
   to the gate's real allowlist (IPFS fetch + re-pin via `addGateAddrs`) and stays whitelisted
   after. Needs a pinnable IPFS backend unless `--cid`/`--from-cid` are supplied.
3. **Operator address defaults to a seed-derived fresh address** (repeat runs never trip
   `isConsumed`); overridable. Named **`address`** (flag `--address`), not "operator".

## Recipe API

`tools/recipes/src/recipes/create-operator.ts`, csm-only (throws on `ctx.module !== 'csm'`):

```ts
export interface CreateCsmOperatorOptions {
  keysCount?: number; // default 1
  selector?: string; // absent → PermissionlessGate; 'ics' | 'idvtc' | 0x… → vetted gate
  address?: Hex; // default: deriveAddress(seed, 'csm-operator')
  manager?: Hex; // default zeroAddress → contract defaults to the sender
  reward?: Hex; // default zeroAddress → contract defaults to the sender
  extendedManagerPermissions?: boolean; // default false
  seed?: Hex; // keys + address determinism; default randomSeed()
  fromCid?: string; // gated: read current tree from this CID instead of gate treeCid()
  cid?: string; // gated: skip pinning the merged tree (hermetic-test bypass)
}

export interface CreateCsmOperatorResult {
  noId: bigint;
  address: Hex; // the created operator's sender/owner address
  publicKeys: Hex[];
  bond: bigint; // wei sent as value
  treeCid?: string; // gated path only — the re-pinned allowlist CID
}
```

## Flow

1. `seed = opts.seed ?? randomSeed()`; `address = opts.address ?? deriveAddress(seed, 'csm-operator')`.
   `deriveAddress` (+ its keccak-low-20-bytes shape) moves from `cm/index.ts` local scope to a
   shared `tools/recipes/src/derive.ts` (same package — NOT core; cm re-imports it).
2. `randomKeys(keysCount, seed)` → `packedKeys` / `packedSignatures` / `publicKeys`.
3. Gate resolution:
   - **permissionless:** `ctx.addresses.PermissionlessGate` + `permissionlessGateAbi`;
     `curveId = CURVE_ID()`. No proof, no pause surface.
   - **gated:** `resolveGate(ctx, selector)` + `vettedGateAbi`;
     `addGateAddrs(ctx, { selector, addresses: [address], fromCid, cid })` whitelists the address —
     its result gains a new field **`addresses: Hex[]`** (the post-union full allowlist, already
     computed internally) so the proof is
     `buildAddressesTree(result.addresses).getProof([address])` with no IPFS refetch. If the gate
     `isPaused()`, grant `RESUME_ROLE` to the admin and `resume()` (same discipline as cm's
     `createCuratedOperator`).
4. `bond = Accounting.getBondAmountByKeysCount(keysCount, curveId)`.
5. `actAs(ctx, address, …)`: inside the body (actAs itself resets the balance to 100 ETH on
   entry), when `bond + 1 ETH > 100 ETH`, `setBalance` to `bond + 10 ETH`. `simulateContract` `addNodeOperatorETH(keysCount, packedKeys,
   packedSignatures, { managerAddress, rewardAddress, extendedManagerPermissions }, [proof,]
   referrer = zeroAddress)` with `value = bond` to capture the returned `noId`, then
   `writeContract` the simulated request.

No post-assertions (matches `createCuratedOperator`) — returns the result object.

## CLI

New `RecipeCommand` in `cli/commands/csm.ts`: `csm create-operator [selector] [keys]`.

All four sketch forms parse:

```
csm create-operator                # PermissionlessGate, 1 key
csm create-operator 10             # PermissionlessGate, 10 keys
csm create-operator idvtc          # IdvtcGate, 1 key
csm create-operator idvtc 10       # IdvtcGate, 10 keys
```

### define.ts extension 1 — `match` predicate (order-free positionals)

`OptionSpec` gains `match?: (token: string) => boolean`. When any positional in a command declares
`match`, positional tokens fill the **first unfilled positional whose predicate accepts the token**
(options without `match` accept anything, preserving today's order semantics for every existing
command). For `create-operator`: `keys` matches `/^\d+$/`; `selector` matches
`ics|idvtc|^0x[0-9a-fA-F]{40}$`. A token neither accepts → error.

### define.ts extension 2 — boolean (valueless) flags

Every current flag takes a value (`--flag <v>`). `--extended-manager-permissions` is a pure switch:
commander stores `true`, so `defineCommand`'s coercion path must pass a non-string raw through when
the flag spec has no `<value>` placeholder (a `toBool`-style no-op; `coerce` is skipped or receives
`true`). Smallest change that keeps the `OptionSpec` shape.

### Flags

| flag                             | key                          | coerce           | notes                            |
| -------------------------------- | ---------------------------- | ---------------- | -------------------------------- |
| `--selector <name>`              | `selector`                   | `identity`       | positional, `match` selector-ish |
| `--keys <n>`                     | `keysCount`                  | `toNumber`       | positional, `match` digits       |
| `--address <addr>`               | `address`                    | `toAddressValue` |                                  |
| `--manager <addr>`               | `manager`                    | `toAddressValue` |                                  |
| `--reward <addr>`                | `reward`                     | `toAddressValue` |                                  |
| `--extended-manager-permissions` | `extendedManagerPermissions` | boolean switch   |                                  |
| `--seed <hex>`                   | `seed`                       | `toHexValue`     |                                  |
| `--from-cid <cid>`               | `fromCid`                    | `identity`       | gated only                       |
| `--cid <cid>`                    | `cid`                        | `identity`       | gated only                       |

Report (human mode): `noId`, `address`, bond in ETH, pubkey list, `treeCid` when gated. `--json`
follows the universal contract (bigints as strings).

## Testing (hermetic, per repo convention)

- **Recipe tests** (fake viem client, like existing recipe suites): permissionless path (no proof
  arg, `CURVE_ID` read, bond as value, defaults manager/reward = zeroAddress); gated path (proof
  present + verifies against the installed root, `addGateAddrs` called with the operator address,
  paused-gate resume); `--address`/`seed` determinism; the funding boundary (bond > 100 ETH gets the extra `setBalance`).
- **`addGateAddrs` result extension**: existing tests extended to assert the new `addresses` field
  (union, checksummed, sorted).
- **CLI tests** (via `connectImpl` seam): the four positional sketch forms, order-free `10 idvtc`,
  flag↔positional precedence, boolean flag mapping, `--json` output.
- Gated tests use `cid`/`fromCid` bypasses — no IPFS on the wire.

## Out of scope

- StETH/WstETH creation variants (`addNodeOperatorStETH`/`WstETH`) — ETH only.
- `referrer` exposure — hardwired `zeroAddress`.
- cm module support — csm-only; cm keeps `createCuratedOperator`.
- Post-creation composition (deposit/top-up) — compose via existing commands.
