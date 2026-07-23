# @sm-lab/recipes

## 0.5.1

### Patch Changes

- Updated dependencies [7e5668a]
  - @sm-lab/keys@0.3.0

## 0.5.0

### Minor Changes

- a3b1ca6: `createCsmOperator` recipe + `sm-recipes csm create-operator`: create a CSM node operator with
  fresh keys and exact ETH bond through the PermissionlessGate (default) or a vetted gate
  (`ics`/`idvtc` — persistently whitelists the address and proves it). CLI gains order-free
  positionals (`create-operator idvtc 10` == `create-operator 10 idvtc`) and boolean switch flags;
  `addGateAddrs` now returns the post-union allowlist `addresses`.

### Patch Changes

- 59a53b2: `connect()` now forces anvil automine on so write→simulate recipes (e.g. install a gate tree, then
  prove against it) see fresh state regardless of how the fork was launched.

## 0.4.3

### Patch Changes

- 3656afb: Add a `typesVersions` shim so the `./cm` subpath's types resolve under legacy
  `moduleResolution: node`/`node10` consumers (e.g. csm-widget on TS 5.7). node10
  ignores the `exports` map, so subpath declarations were invisible; root imports were
  unaffected. `bundler`/`node16`/`nodenext` consumers are unchanged (they keep using
  `exports`). Stopgap until consumers move off node10 (removed in TS 7).

## 0.4.2

### Patch Changes

- Updated dependencies [ef963b7]
  - @sm-lab/keys@0.2.2

## 0.4.1

### Patch Changes

- 3f8c8cf: Fix `add-gate` on a gate with an empty allowlist. An empty gate carries a **placeholder** `treeCid`
  (e.g. `"someCid"`), not a real pinned CID — `addGateAddrs` previously tried to fetch it and failed
  with a cryptic `GET /ipfs/someCid 400`. It now recognizes a non-CID `treeCid` as "no current tree"
  and treats it as an empty set (installs just the new addresses), exactly like a fresh gate.

  - **merkle** exports `isLikelyCid(value)` (the same `CID.parse` check the `@sm-lab/ipfs` gateway
    uses), so callers can tell a real pinned tree from an unset/placeholder one before fetching. A
    real allowlist is always pinned under a valid CID; a valid-but-unreachable CID still throws (now
    with an actionable message that includes the caller's skip hint), so a real allowlist is never
    silently dropped.
  - **recipes** `addGateAddrs` gates the IPFS fetch on `isLikelyCid(treeCid)`.

- Updated dependencies [3f8c8cf]
  - @sm-lab/merkle@1.5.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [e1fe8ea]
  - @sm-lab/merkle@1.4.0

## 0.3.1

### Patch Changes

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

- Updated dependencies [ae50802]
  - @sm-lab/merkle@1.3.0

## 0.3.0

### Minor Changes

- 8141636: `exit-request` now optionally reflects the exit on a running cl-mock: when `ctx.clMockUrl` (or the
  CLI `--cl-mock-url` / `CL_MOCK_URL`) is set, the validator is marked `active_exiting` with its
  effective balance (32 ETH + allocated), mirroring `clActivate`. Skipped silently when no cl-mock is
  configured — the on-chain VEBO submit is unaffected.
- d90381d: Add the `exit-request` recipe + CLI command: submit a single validator-exit request to the
  Validators Exit Bus Oracle (VEBO) by impersonating its consensus contract and a `SUBMIT_DATA_ROLE`
  holder. Module-agnostic (csm + cm); auto-mirrored under the `csm`/`cm` CLI groups.
  `sm-recipes exit-request <operator-id> <key-index> [--validator-index n]`.
- 0441bf9: Add recipes: `set-target-limit`, `remove-key`, `get-curve-info`, and a unified `pause`/`resume`
  that targets the module, accounting, or any gate (ics/idvtc for csm; po…iodcp for cm), across both
  csm and cm. Exposed as CLI commands (shared, mirrored under the `csm`/`cm` groups).

  Also add on-chain `activate-keys` and `report-balance` (Verifier-gated), `topup` (anvil
  `setBalance`), and six read-only recipes: `bond-info`, `operator-keys`, `key-balances`,
  `operators-count`, `get-last-operator`, and `get-gate-tree`. Exposed as CLI commands (shared,
  mirrored under the `csm`/`cm` groups).

- 449aa14: Refresh mainnet address books and restructure gate fields.

  - `@sm-lab/receipts`: add `mainnet.cm` (CMv2 curated deployment) and move `mainnet.csm` to v3
    (adds `IdvtcGate`; updates `Ejector` + `PermissionlessGate`).
  - **Breaking:** csm gate fields renamed `VettedGate` → `IcsGate` and
    `IdentifiedDVTClusterGate` → `IdvtcGate`; the unused `GateSeal` field is removed.
  - **Breaking:** cm `CuratedGates: Hex[]` is replaced by flat named fields
    `CuratedGatePO`/`PTO`/`PGO`/`DO`/`EEO`/`IODC`/`IODCP` (matching the lido-csm-sdk gate roles).
  - `@sm-lab/recipes`: `resolveGate` follows the renamed/flattened fields. Gate selectors
    (`ics` / `idvtc` / `po`…`iodcp` / numeric index) and the CLI surface are unchanged.

### Patch Changes

- Updated dependencies [449aa14]
  - @sm-lab/receipts@0.2.0
  - @sm-lab/keys@0.2.1

## 0.2.0

### Minor Changes

- ad3a42b: Add `@sm-lab/recipes` (anvil recipes MVP, increment 6b): `connect` (LidoLocator-resolved
  context) + the `actAs` impersonation engine, plus `addKeys`, `operatorInfo`,
  `warpBy`/`snapshot`/`revert`, `cm` `createCuratedOperator`, and `csm` `setGateAddrs` (ics).
  TypeScript API only; reuses `@sm-lab/receipts` (ABIs/addresses) and `@sm-lab/merkle`
  (tree building). No Foundry.
- a380da9: Add operator-lifecycle recipe families (increment 6c): manager/reward address proposal+confirm,
  `unvet`/`exit`/`deposit`/`slash`/`withdraw`, penalty report/cancel/settle/compensate, and bond ops
  (`addBond`/`createBondDebt`). All shared (csm + cm), built on the `actAs` engine.
- ba506dc: Add the cl-mock bridge (increment 6d): `clActivate(ctx, { noId, keyIndex })` reads a key's pubkey
  and allocated balance on-chain, then marks it `active_ongoing` on a running `@sm-lab/cl`
  (`ctx.clMockUrl`) with effective balance = 32 ETH + allocated balance, in gwei (full precision,
  diverging from the source's integer-ETH truncation). Also exports the underlying typed reads
  `getPubkey` / `getKeyBalance` and the thin `setClValidator` HTTP client.
- d1d2d02: Add `submitRewards(ctx, report)` (increment 6e, PR-2): submit a `RewardsReport` (from `makeRewards`)
  on-chain as an oracle report — fund the FeeDistributor when `pendingSharesToDistribute` can't cover
  the frame, warp to the next valid consensus frame, build the `IFeeOracle.ReportData` tuple, reach
  consensus across the fast-lane members (with a `getMembers` fallback), and submit the report data as
  `members[0]`. Returns `{ submitted, refSlot, treeRoot, reportHash, members }`; a zero-root report is a
  graceful no-op (`{ submitted: false }`), so `submitRewards(ctx, await makeRewards(ctx))` composes on
  an empty fork.

  Also adds `warpTo(ctx, timestamp)` — warp fork time to an absolute unix timestamp
  (`setNextBlockTimestamp` + `mine`), the absolute counterpart of `warpBy`, used by the consensus-frame
  wait. The `reportHash` is `keccak256(abi.encode(data))` over the 9-field struct encoded as one tuple
  parameter, with `strikesTreeRoot = keccak256(abi.encode("mock-strikes", refSlot))`.

- d1d2d02: Add `makeRewards(ctx, opts?)` (increment 6e, PR-1): build the cumulative FeeDistributor rewards
  tree off on-chain operator state plus a seeded mock reward per active key, pin the tree + report
  log to IPFS (guarded; `IPFS_API_URL` or `PINATA_*`, or pass `treeCid`/`logCid` to skip), and
  return a typed in-memory `RewardsReport` (`treeRoot`, `treeCid`, `logCid`, `distributed`, `rebate`,
  `treeDump`, `cumulatives`).

  The per-key draw is fully seeded (keccak hash-chain — no `Math.random`) so `treeRoot`/`distributed`
  are reproducible. Carry-forward is via the injectable `opts.previousCumulatives` (Map or entries);
  prior leaves carry forward (the `uint64`-max pad excluded) before this frame's deltas. Bigint
  report fields are normalized to strings before pinning (the OZ dump and the log both carry bigints).
  An empty report (no active keys, no carry-forward) returns a zero root and pins nothing.

- ae31fca: Add increment 6f: csm `idvtc` gate selector (`resolveGate(ctx, 'idvtc')` →
  `IdentifiedDVTClusterGate`, v3-only/hoodi; throws on snapshots lacking it, e.g. mainnet/v2) and cm
  group/curve recipes (`createOperatorGroup`, `resetOperatorGroup`, `setBondCurveWeight`, ported from
  `MetaRegistryHelpers.s.sol`, exported via `@sm-lab/recipes/cm`). `seedCm` + `topUpActiveKeys`
  deferred to 6f-2.
- e08bab9: Add the operator top-up recipes and the cm seed composite. `increaseAllocatedBalance(ctx, { noId,
keyIndex, amountWei })` and `topUpActiveKeys(ctx, { noId })` write `CSModule.allocateDeposits` as the
  StakingRouter — single-key and FIFO-over-all-active-keys (2016 ETH cap/key), porting
  `NodeOperators.s.sol`. `topUpActiveKeys` reads per-key state up front and writes sequentially in
  key-index order (TopUpQueueOps FIFO). `seedCm(ctx, { selector?, seed? })` (`@sm-lab/recipes/cm`)
  composes createCuratedOperator/createOperatorGroup/addKeys/deposit/topUpActiveKeys into the
  `fork.just seed-cm` scenario, using returned noIds (not hardcoded indices) and deterministic operator
  addresses.
- da93973: `sm-recipes` CLI polish: new `completion <shell>` command (static bash/zsh/fish scripts
  covering the nested `cm`/`csm` groups; `sm-recipes completion fish | source`) and `--version`.
  Help is now agent-discoverable: every option carries a description (gate `--selector` values
  are enumerated for csm `set-gate`/`resolve-gate` and cm `create-curated-operator`/`seed`;
  `--tree-cid`/`--log-cid` document the skip-IPFS escape; coercer-derived fallbacks cover the
  rest), leaf `--help` lists the global `--json`/`--module`/`--rpc-url` options
  (`showGlobalOptions`), and each command's help states its positional-alias order. csm
  `set-gate` now accepts any selector `resolveGate` accepts (`ics` | `idvtc` | `0x…` address),
  not just `ics`. Internally adopts merkle's `buildAddressesTree` rename (no API change from
  recipes itself).
- 9082b9b: feat(cli): `sm-recipes` now defaults `--rpc-url` to anvil's `http://127.0.0.1:8545` (after
  `--rpc-url` flag and `RPC_URL`), and mirrors every shared recipe under the `cm`/`csm` groups
  with the module pre-bound. A shared command works two ways — top-level with `--module`
  (`sm-recipes operator-info --module csm`) or under its group with no flag
  (`sm-recipes csm operator-info`). cm/csm-only recipes are unchanged.

  Every required, non-repeatable option is now also accepted positionally, in declaration order:
  `sm-recipes csm operator-info 0` == `--operator-id 0`, `withdraw 0 1 32` ==
  `--operator-id 0 --key-index 1 --exit-balance 32`. Flags still work and can be mixed with
  positionals; optional options stay flag-only by default. A descriptor can opt an option in or
  out via `positional`, including exposing a repeatable option as the trailing **variadic**
  positional. `set-gate` uses this for `<selector> <address...>`:
  `sm-recipes csm set-gate idvtc 0xabc... 0xdef...` ==
  `--selector idvtc --address 0xabc... --address 0xdef...`.

  A `help` command is enabled: `sm-recipes help [command]` mirrors `--help` (and the `cm`/`csm`
  groups get it too — `sm-recipes csm help`, `sm-recipes help csm`).

- b7eeb8b: Add the `sm-recipes` CLI — a run-and-exit front-end over the recipe surface (declarative
  command registry; shared commands plus `cm`/`csm` groups; ETH-denominated amounts; `--json`).
- feat(recipes): gate commands (`set-gate` + `resolve-gate`) now work for cm too, with cm's own gate
  list. The gate recipe was module-agnostic all along (fork.just's `set-gate-addrs`/`update-gate-tree`
  are selector-driven, and the csm VettedGate + cm CuratedGate share a byte-identical
  grantRole/setTreeParams/getRoleMember surface), so `setGateAddrs` moved from the csm-only subpath to
  a shared recipe that dispatches on `ctx.module`: it resolves the module's gate, picks the module's
  default selector (csm `ics`, cm `po`), and uses the module's ABI.

  - CLI: the `cm` group gains `set-gate <selector> <address...>` and `resolve-gate <selector>` with
    cm-tailored help (`po|pto|pgo|do|eeo|iodc|iodcp`, gate index `0-6`, or a raw `0x…` address; default
    `po`). The `csm` group is unchanged.
  - Library: `setGateAddrs` (+ `SetGateAddrsOptions`/`SetGateAddrsResult`) is now exported from the root
    `@sm-lab/recipes` entry. The now-empty `@sm-lab/recipes/csm` subpath is removed (csm has no
    module-specific recipe surface — its `ics`/`idvtc` selectors resolve via the root-exported
    `resolveGate`). No published consumers exist yet.

### Patch Changes

- 5054cb4: chore(deps): security + dependency maintenance.

  - Patch transitive advisories via pnpm overrides: `ws` >=8.21.0 (GHSA-96hv-2xvq-fx4p, high) and `uuid` >=11.1.1 under `@metamask/utils` (GHSA-w5hq-g745-h8pq, moderate).
  - Bump runtime deps: commander 15, dotenv 17, multiformats 14, @hono/node-server 2, @chainsafe/bls 8.
  - Bump dev toolchain: TypeScript 6, Vitest 4, @types/node 26, prettier 3.9.

- 6e7c8a6: receipts: slim committed address data to a strictly-typed allowlist (drop DeployParams, \*Impl,
  linked libs), and optionally bake LidoLocator-resolved protocol addresses into a `protocol` block
  during `--rpc`-gated refresh (with `manifest.protocolResolvedAt` provenance). recipes `connect()`
  and the keys tool now prefer the baked block and fall back to their previous behavior when absent.
- Updated dependencies [0067039]
- Updated dependencies [5054cb4]
- Updated dependencies [bed9b0d]
- Updated dependencies [da93973]
- Updated dependencies [da93973]
- Updated dependencies [486b033]
- Updated dependencies [a2b9d20]
- Updated dependencies [d1d2d02]
- Updated dependencies [ae31fca]
- Updated dependencies [da93973]
- Updated dependencies [6e7c8a6]
  - @sm-lab/keys@0.2.0
  - @sm-lab/merkle@1.2.0
  - @sm-lab/receipts@0.1.0
