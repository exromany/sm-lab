# receipts — slim, enrich, strict — design

Status: **approved (design)** · Date: 2026-06-29 · Owner: exromany

Reshapes what `@csm-lab/receipts` commits as its per-(chain, module) address data and how
`scripts/refresh.ts` produces it. Three cohesive changes to one artifact —
`data/<chain>/<module>.json` — plus the dedup payoff in the two consumers that currently
work around its gaps.

## Goal

Today `refresh.ts` copies the contracts-repo deploy JSON **verbatim** into the committed
fixture (`refresh.ts:78`, `JSON.stringify(snapshot)`). That drags in noise the package never
uses and leaves real gaps:

- **Noise.** A ~3 KB `DeployParams` ABI-encoded blob, every `*Impl` address, 9 linked-library
  addresses, and assorted untyped extras. The loose `[key: string]: AddressBookExtra` index
  signature on the address-book types (`types.ts:27`) exists _only_ to tolerate this dump.
- **Gaps.** The protocol addresses (`stakingRouter`, `lido`, `withdrawalVault`, …) are not in
  the deploy JSON. Two consumers paper over that: `recipes/context.ts:82` re-resolves 5 of them
  from `LidoLocator` on **every** `connect()`, and `tools/keys/src/constants.ts:22-34`
  **hardcodes** `withdrawalVault` per chain.

We want the committed fixture to be a **slim, strictly-typed, self-describing** address book:
only addresses consumers use, enriched once with the on-chain protocol addresses, so the
consumers stop duplicating.

## Constraints (decided)

| #   | Decision                          | Notes                                                                                                                                                       |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Allowlist + strict types**      | Write only the typed fields. Drop the `[key: string]` catch-all and `AddressBookExtra`. refresh **warns** per dropped source key so a new contract is loud.  |
| 2   | **Enrich: used-only (6)**         | Bake `stakingRouter`, `validatorsExitBusOracle`, `lido`, `withdrawalQueue`, `burner`, `withdrawalVault` into a nested `protocol` block. YAGNI on the rest.   |
| 3   | **RPC optional; skip + warn**     | `--rpc` / env. No RPC → skip enrichment, **carry forward** the prior file's `protocol`, warn. ABI-only refreshes stay offline. Consumers fall back.           |
| 4   | **Update both consumers**         | `connect()` prefers baked `protocol`, runtime LidoLocator reads as fallback. keys prefers baked `withdrawalVault`, hardcoded constant as fallback.            |
| 5   | **Validation gate**               | After curation, throw if a required typed field is missing or not a valid 20-byte address. Turns deploy-JSON drift into a hard error at refresh time.        |
| 6   | **Provenance: resolved-at block** | Record `{ chainId, block }` per snapshot in `manifest.json` when enrichment runs; carry forward on skip.                                                      |
| 7   | **Package stays zero-runtime**    | `viem` is added as a **devDependency** for the refresh script only. No runtime `import` of viem in shipped `dist/` or the data path.                          |
| 8   | **Non-breaking by construction**  | `protocol` is optional; both consumers fall back. An un-enriched / offline refresh degrades cleanly to today's behavior.                                     |

## Scope

In: `fixtures/receipts` data shape + `refresh.ts`/`refresh-lib.ts` + `types.ts` + manifest;
`tools/recipes/src/context.ts` (`connect`); `tools/keys` (`withdrawalVault` source). Tests,
README, changeset.

Out: mainnet `cm` snapshot (still absent — unrelated); decoding `DeployParams`; resolving the
broader LidoLocator getter set; anvil state. `forkVersion` stays a keys-local CL constant
(genesis data, not on-chain).

## Curated data shape

`data/hoodi/csm.json` (illustrative — values elided):

```jsonc
{
  "CSModule": "0x…",
  "Accounting": "0x…",
  "FeeDistributor": "0x…",
  "FeeOracle": "0x…",
  "HashConsensus": "0x…",
  "ParametersRegistry": "0x…",
  "ValidatorStrikes": "0x…",
  "Verifier": "0x…",
  "Ejector": "0x…",
  "ExitPenalties": "0x…",
  "GateSeal": "0x…",
  "LidoLocator": "0x…",
  "VettedGate": "0x…",
  "PermissionlessGate": "0x…",
  "IdentifiedDVTClusterGate": "0x…", // v3-only; omitted on mainnet/v2
  "ChainId": 560048,
  "git-ref": "a6be…", // kept — co-located provenance, also in manifest
  "protocol": {
    // optional; present iff enriched (this run or carried forward)
    "stakingRouter": "0x…",
    "validatorsExitBusOracle": "0x…",
    "lido": "0x…",
    "withdrawalQueue": "0x…",
    "burner": "0x…",
    "withdrawalVault": "0x…"
  }
}
```

`cm` is the same minus `CSModule`/gates, plus `CuratedModule`, `MetaRegistry`,
`CuratedGateFactory`, and `CuratedGates: Hex[]`.

**Dropped (warned):** `DeployParams`, every `*Impl`, the linked libs (`AssetRecovererLib`,
`WithdrawnValidatorLib`, `TopUpQueueOps`, `StakeTracker`, `NodeOperatorOps`, `NOAddresses`,
`GeneralPenalty`, `DepositQueueOps`, `BondCurvesLib`), and untyped extras (`CircuitBreaker`,
`VettedGateFactory`, `IdentifiedDVTClusterCurveSetup`, `VerifierV3`). The drop-warning is the
safety net: if one of these turns out to matter, it surfaces at refresh and gets promoted into
the schema deliberately.

`protocol` keys use the **canonical LidoLocator getter names** (`validatorsExitBusOracle`, not
`vebo`) for auditability; `connect()` maps `validatorsExitBusOracle` → its internal `vebo`.

## One schema drives curation, validation, and the warn

A runtime field schema in `refresh-lib.ts` is the single source of truth — TS interfaces vanish
at compile time, so a runtime representation is needed regardless:

```ts
type FieldKind = 'address' | 'address[]' | 'number' | 'string';
interface FieldSpec {
  kind: FieldKind;
  optional?: boolean;
}
// per module
const CSM_SCHEMA: Record<string, FieldSpec> = {
  CSModule: { kind: 'address' },
  /* …typed proxies… */ IdentifiedDVTClusterGate: { kind: 'address', optional: true },
  ChainId: { kind: 'number' },
  'git-ref': { kind: 'string' },
};
```

`curate(snapshot, schema)` walks the schema, pulls + validates each field from the source, and
returns `{ book, dropped }` where `dropped` is every source key absent from the schema. The
validation gate (`address` must match `/^0x[0-9a-fA-F]{40}$/`; required + missing → throw) and
the drop-warning both fall out of this one pass. `protocol` is not in this schema (it is not
sourced from the deploy JSON) — it is attached separately by enrichment.

## refresh flow (extends `runRefresh`)

Steps 1–2 (git-ref guard, ABI extraction) are unchanged. Step 3 (address write) and step 4
(manifest) change:

1. **git-ref guard** — unchanged.
2. **ABIs** → `src/abi/*` + hashes — unchanged.
3. **Curate** — `curate(snapshot, schema)`; warn each `dropped` key.
4. **Enrich (new):**
   - Resolve RPC: `--rpc <url>` ?? `${CHAIN.toUpperCase()}_RPC_URL` ?? `ETH_RPC_URL`.
   - **Has RPC:** read the 6 getters off the curated `LidoLocator` via the injected reader,
     validate non-zero, attach `protocol`, capture `block` + `chainId`.
   - **No RPC:** read the **existing committed file before overwrite**, carry its `protocol`
     forward onto the new book, warn `⚠ no RPC — skipping protocol enrichment, keeping prior`.
     First-ever refresh with no RPC → `protocol` omitted (optional); consumers fall back.
5. **Write** curated+enriched book → `data/<chain>/<module>.json`.
6. **Manifest** — abi hashes + snapshot ref (as today) + `protocolResolvedAt[chain/module] =
   { chainId, block }` when enriched, carried forward on skip.

**Hermetic seam.** Enrichment takes an injected locator-reader
(`(locator: Hex, getters: string[]) => Promise<Record<string, Hex>>` + a `blockNumber()`),
mirroring the repo's `connectImpl` / `ipfs.ts` injection pattern. `refresh.ts` wires a real viem
public client; tests pass a fake. No network in tests.

## Manifest

```ts
interface Manifest {
  abiGitRef: string;
  abiHashes: Record<string, string>;
  snapshots: SnapshotRef[];
  protocolResolvedAt?: Record<string, { chainId: number; block: number }>; // "chain/module"
  generatedAt: string;
}
```

`mergeManifest` gains carry-forward semantics for `protocolResolvedAt` (replace the current
`chain/module` entry on enrich; preserve on skip), matching how it already replaces `snapshots`.

## Types (`types.ts`)

- Add `interface ProtocolAddresses` (6 `Hex` fields).
- `CsmAddressBook` / `CmAddressBook`: enumerate **only** allowlisted fields, add
  `'git-ref': string` and `protocol?: ProtocolAddresses`.
- **Delete** the `[key: string]: AddressBookExtra` index signature and the `AddressBookExtra`
  type. Consumers use only typed fields (verified: recipes + keys).

## Consumer dedup

**recipes `connect()` (`context.ts`):**

```ts
const p = book.protocol;
const resolved = p
  ? {
      stakingRouter: p.stakingRouter,
      vebo: p.validatorsExitBusOracle,
      lido: p.lido,
      withdrawalQueue: p.withdrawalQueue,
      burner: p.burner,
    }
  : await readFromLocator(client, book.LidoLocator); // current 5 reads, unchanged
```

`ResolvedAddresses` is unchanged (still the 5 it exposes). `withdrawalVault` is keys' concern,
not recipes' — not added to `connect`'s surface (YAGNI).

**keys tool:** prefer receipts by chainId, fall back to the hardcoded constant:

```ts
const wv = receiptsProtocol(chainId)?.withdrawalVault ?? CHAIN_CONSTANTS[chain].withdrawalVault;
```

Adds `@csm-lab/receipts` as a keys dependency. `forkVersion` stays hardcoded (CL genesis
constant, not on-chain).

## Testing

Hermetic, no network/chain (repo rule):

- **refresh-lib:** curation allowlist (drops noise, returns `dropped`); validation gate throws
  on missing/malformed required address; enrichment via fake reader attaches `protocol` +
  block; **skip path preserves prior `protocol`**; `mergeManifest` carry-forward.
- **refresh (e2e):** existing hermetic e2e extended — no-RPC run produces slim file with no
  `protocol`; with-fake-reader run bakes `protocol` + manifest provenance.
- **recipes context:** `connect()` prefers baked `protocol`; falls back to runtime reads when
  absent (extend the existing fake-client tests).
- **keys:** prefers receipts `withdrawalVault`; falls back to constant when `protocol` absent.

## Docs / release

- Update `fixtures/receipts/README.md` (new data shape, `--rpc`/env, `protocol`, provenance).
- Reconcile the receipts bullet in `CLAUDE.md` "Status" and any ADR note on the address model
  (ADR-0001 #8 / the anvil-recipes constraint #4, which states "protocol addresses are NOT in
  the snapshot" — now optionally baked).
- **Changeset:** receipts (data shape) + recipes (connect behavior) + keys (wc source) are
  user-facing. `core`/`config` ignored as usual.

## Per-package gates (done-check)

For each touched package: `build` · `types` · `test` · `oxlint <dir>` ·
`prettier --check "<dir>/**/*.{ts,json}"`.
