# BLS deposit-key generator (`@csm-lab/keys`) — design

Status: **approved (design)** · Date: 2026-06-28 · Owner: exromany

A new `tools/keys` package that generates **real, valid BLS12-381 validator deposit data** in pure
TypeScript — replacing the external `eth-staking-smith` Rust binary that the csm-widget e2e suite
downloads via `tests/scripts/set_up_keys_generator.sh`.

## Goal

The csm-widget e2e suite needs valid `deposit_data.json` to drive the widget's **upload-keys UI**.
Those keys must pass the CSM SDK's on-upload validation (`@lidofinance/lido-csm-sdk`
`deposit-data-sdk`), which performs a **real BLS signature verification** — so fake-but-well-formed
keys (csm-lab's existing `recipes/randomKeys`) cannot be used. Today the suite shells out to a
version-/SHA-pinned, **amd64-only** `eth-staking-smith` binary (Rosetta on Apple Silicon), behind a
setup script and a per-call subprocess that writes/reads a temp file.

**Key discovery:** the SDK already ships the *entire* crypto pipeline in pure TS
(`deposit-data-sdk/signature.mjs`: `@chainsafe/ssz` containers + domain math + `bls-eth-wasm`
verify) — it just runs it in the **verify** direction. Generation is the documented inverse. We can
produce keys in-process, hermetically, deterministically, reusing the same primitives — and pin
correctness by round-tripping every signature through that same verify pipeline.

This is **easier** (no binary, no setup script, no platform matrix), **better** (hermetic,
deterministic, matches csm-lab's test ethos, trivially produces negative-test keys), and **faster**
(in-process WASM sign vs per-call subprocess + Rosetta) than the current tool for the 1–26-key
batches the specs use.

## Constraints (decided)

| # | Decision | Notes |
| --- | --- | --- |
| 1 | **Standalone `@csm-lab/keys`, merkle-shaped** | `tools/keys` with `bin: csm-keys` + a TS API. Pure crypto — **no viem, no chain, no `Ctx`**. It does *not* belong inside `@csm-lab/recipes` (a chain/viem library); it is a pure data tool like `@csm-lab/merkle`. Two consumers justify its own package (csm-lab's "promote on a second consumer" rule). |
| 2 | **EIP-2333 / BIP-39 mnemonic derivation** | Generate (or accept) a BIP-39 mnemonic; derive each validator **signing** key via EIP-2333/2334 at `m/12381/3600/{i}/0/0`. Byte-for-byte parity with `eth-staking-smith`; keys are recoverable; the mnemonic is returned. The withdrawal-key derivation path is **not** used (WC is an eth1 address for 0x01/0x02). |
| 3 | **Crypto stack: `@chainsafe/bls` + `bls-keygen` + `ssz`** | `@chainsafe/bls-keygen` (EIP-2333 derivation) → `@chainsafe/bls` (sign/pubkey; **handles SK endianness**, removing the BE→LE footgun) over the `bls-eth-wasm` backend (same crypto as the SDK verifier) → `@chainsafe/ssz` (roots). `@scure/bip39` for the mnemonic. |
| 4 | **Baked-in Lido WC + override** | A small, **sourced** per-chain constant map → Lido `WithdrawalVault` address. Default binds keys to the Lido vault (so they pass widget validation out of the box). Override with `--wc <eth1 address>` / `withdrawalAddress`. WC type byte **`0x01` default, `0x02`** (compounding, for CM). Stays pure — no `@csm-lab/receipts` dep. |
| 5 | **Lean output: `{ mnemonic, keys[] }`** | No raw private keys, no EIP-2335 keystores, no packed helper. The `deposit_data.json` array (eth-staking-smith shape) + the mnemonic. A consumer that needs packed pubkeys/signatures (recipes/addKeys) concatenates `keys[].pubkey` / `keys[].signature` itself. |
| 6 | **Chains: mainnet + hoodi only** | Matches the SDK's supported set (`FIXED_NETWORK` / `FIXED_FORK_VERSION`). `--chain hoodi` is the default. |
| 7 | **Constants mirrored, not imported** | The SSZ containers, domain math, and chain constants are **copied** from the SDK's `signature.mjs` (with a sourcing comment), not imported — csm-lab must not depend on its own consumer (`@lidofinance/lido-csm-sdk`). Drift is caught by the round-trip + golden-vector tests. |

## Scope

**In (v1)** — the standalone `@csm-lab/keys` package: pure core, the `csm-keys` CLI, and a hermetic
test suite. **Adopted by the csm-widget e2e suite** to replace `KeysGeneratorService` +
`set_up_keys_generator.sh` + the binary.

**Out (v1)** —
- Wiring `@csm-lab/recipes` `addKeys` to consume it (a documented *second consumer* / follow-up;
  it is the lever that later closes the "real-deposit on a fork" gap, since the beacon
  `DepositContract` validates `deposit_data_root`). `addKeys` keeps using `randomKeys` until then.
- EIP-2335 keystores (validator-client import — not csm-lab's use case).
- Chains beyond mainnet/hoodi.
- A `verify <file>` CLI command (cheap to add later — the verify pipeline already exists for tests —
  and *that* is when subcommands would earn their place; flat CLI until then).

## Package layout (mirrors `tools/merkle`)

```
tools/keys/
  src/
    constants.ts   # per-chain { chainId, forkVersion, networkName, withdrawalVault } + DOMAIN_DEPOSIT, EIP-2333 path
    ssz.ts         # DepositMessage / DepositData / ForkData / SigningData containers
                   #   + computeForkDataRoot / computeDomain / computeSigningRoot (mirrors SDK signature.mjs)
    keys.ts        # pure core: deriveMaster, withdrawalCredentials, makeDepositKey, makeDepositKeys
    io.ts          # writeDepositDataFile — eth-staking-smith JSON shape (no 0x prefixes)
    cli.ts         # #!/usr/bin/env node — flat commander program (generation is the default action)
    index.ts       # public TS API
  test/
    keys.test.ts   # golden-vector · round-trip-verify · determinism · WC
    fixtures/      # golden deposit_data vector(s) from eth-staking-smith
  package.json     # bin: { "csm-keys": "dist/cli.mjs" }
  tsdown.config.ts
  tsconfig.json    # relative extends ../../packages/config/tsconfig.lib.json
  README.md
```

**Dependencies** (added to the `catalog:` in `pnpm-workspace.yaml`): `@chainsafe/bls`,
`@chainsafe/bls-keygen`, `@chainsafe/ssz`, `@scure/bip39`, `commander`.

## TS API (the contract)

```ts
export type ChainName = 'mainnet' | 'hoodi';
export type WcType = '0x01' | '0x02';

export interface MakeDepositKeysOptions {
  chain?: ChainName;            // default 'hoodi'
  count?: number;               // default 1, must be >= 1
  mnemonic?: string;            // omitted → fresh random BIP-39 (128-bit)
  type?: WcType;                // default '0x01'; '0x02' = compounding (CM)
  withdrawalAddress?: Hex;      // override; default = LIDO_WITHDRAWAL_VAULT[chain]
  startIndex?: number;          // default 0 → derive validators [startIndex .. startIndex+count)
}

export interface DepositKey {   // API objects use 0x-prefixed Hex
  pubkey: Hex;                  // 48 bytes
  withdrawal_credentials: Hex;  // 32 bytes
  amount: 32_000_000_000;       // gwei (32 ETH), the only value the SDK validator accepts
  signature: Hex;              // 96 bytes
  deposit_message_root: Hex;   // 32 bytes
  deposit_data_root: Hex;      // 32 bytes
  fork_version: Hex;           // 4 bytes
  network_name: ChainName;
  deposit_cli_version: string; // "csm-keys/<package version>"
}

export interface MakeDepositKeysResult {
  mnemonic: string;
  keys: DepositKey[];
}

export function makeDepositKeys(opts?: MakeDepositKeysOptions): Promise<MakeDepositKeysResult>;
export function writeDepositDataFile(path: string, keys: DepositKey[]): void;
```

`makeDepositKeys` is `async` because the BLS backend (`@chainsafe/bls` / `bls-eth-wasm`) requires a
one-time async init.

`writeDepositDataFile` serializes `keys` to the **eth-staking-smith JSON shape with no `0x`
prefixes** — a drop-in for the widget's parser (`parseDepositData` normalizes both forms; matching
the binary's exact shape keeps the fixture diff clean).

## Core data flow (per validator `i`)

Mirrors the SDK's verify pipeline, run forward:

1. `master = deriveMasterSK(mnemonicToSeed(mnemonic))` · `sk = deriveEth2ValidatorKeys(master, startIndex + i).signing` (EIP-2333; `@chainsafe/bls` loads it endianness-correct).
2. `pubkey = sk.toPublicKey().toBytes()` (48 bytes).
3. `withdrawal_credentials = type_byte ++ 11 zero bytes ++ withdrawalAddress` (32 bytes).
4. `deposit_message_root = DepositMessage.hashTreeRoot({ pubkey, withdrawal_credentials, amount: 32e9 })`.
5. `domain = computeDomain(DOMAIN_DEPOSIT, forkVersion[chain], genesisValidatorsRoot = 32 zero bytes)`.
6. `signature = sk.sign(SigningData.hashTreeRoot({ object_root: deposit_message_root, domain }))` (96 bytes).
7. `deposit_data_root = DepositData.hashTreeRoot({ pubkey, withdrawal_credentials, amount, signature })`.
8. Assemble `DepositKey` with `fork_version`, `network_name`, `deposit_cli_version`.

`computeForkDataRoot` / `computeDomain` / `computeSigningRoot` and the four `ContainerType`
definitions are transcribed from `deposit-data-sdk/signature.mjs` (with `DepositData` extended to the
4-field container for `deposit_data_root`, which the SDK's verify-only path omits).

## Constants (`constants.ts`)

Per-chain — **addresses to be verified at build time against `LidoLocator.withdrawalVault()`**
before first publish:

| chain | chainId | fork_version | network_name | Lido WithdrawalVault (verify) |
| --- | --- | --- | --- | --- |
| `mainnet` | 1 | `0x00000000` | `mainnet` | `0xB9D7934878B5FB9610B3fE8A5e441e8fad7E293f` |
| `hoodi` | 560048 | `0x10000910` | `hoodi` | `0x4473dCDDbf77679A643BdB654dbd86D67F8d32f2` |

Shared: `DOMAIN_DEPOSIT = 0x03000000`, `genesis_validators_root = 32 × 0x00`, `amount =
32_000_000_000` gwei, EIP-2333 signing path `m/12381/3600/{i}/0/0`. (Hoodi vault sourced from the
current `keysGenerator.service.ts` default; both must be confirmed via the locator.)

## CLI surface (`csm-keys`)

Flat commander program — generation is the default action (no subcommand):

```
csm-keys --count 5                       # hoodi, 0x01  (all defaults) → JSON to stdout
csm-keys --chain mainnet --count 1
csm-keys --count 1 --type 0x02           # compounding (CM)
csm-keys --count 3 --mnemonic "..."      # reproducible
csm-keys --count 2 --wc 0xCustomAddress  # WC override
csm-keys --count 5 -o deposit_data.json  # also write file
csm-keys --help
```

| flag | default | notes |
| --- | --- | --- |
| `--chain <mainnet\|hoodi>` | `hoodi` | |
| `--count <n>` | `1` | must be ≥ 1 |
| `--type <0x01\|0x02>` | `0x01` | same vocabulary as the TS API `type` (no `--compounding`) |
| `--mnemonic <phrase>` | random | BIP-39, 128-bit when omitted |
| `--wc <address>` | Lido vault | eth1 address override |
| `-o, --out <path>` | — | write `deposit_data.json`; otherwise stdout |

Deposit data → **stdout / `-o`** (clean JSON). The mnemonic → **stderr** (so piping stays clean).
Actions are wrapped like merkle's `run()` helper: print a clean message and `process.exit(1)` on
error.

## Error handling

Validate before any crypto (precise errors beat opaque BLS/SSZ failures): unknown `chain`, `count <
1`, malformed/short mnemonic, non-address `--wc`, invalid `--type`. `noUncheckedIndexedAccess` is on
— guard the per-chain constant lookups.

## Testing (hermetic, the crux)

1. **Golden vector** — generate one key from a *fixed* mnemonic + chain + index; assert byte-for-byte
   against an `eth-staking-smith` reference fixture. Pins the BE→LE endianness handling and SSZ
   correctness.
2. **Round-trip verify** — re-verify **every** generated signature with the SDK's exact verify
   pipeline (mirrored in the test: recompute `deposit_message_root`, `computeDomain`,
   `computeSigningRoot`, `bls.verify`). Must return `true` → proves widget acceptance.
3. **Determinism** — same `mnemonic` + `startIndex` → identical keys; omitted mnemonic → distinct
   keys across runs.
4. **WC** — `0x01` / `0x02` prefix correctness, default Lido-vault binding, and `--wc` override.

All hermetic: no network, no chain, no binary.

## Consumers

- **v1 — csm-widget e2e.** `tests/shared/services/keysGenerator.service.ts` becomes a thin wrapper
  over `@csm-lab/keys` (or the suite calls `makeDepositKeys` directly). Deletes
  `tests/scripts/set_up_keys_generator.sh` and the binary; `test:setup` loses a step.
- **Future — `@csm-lab/recipes` `addKeys`.** Swap `randomKeys` → `makeDepositKeys` (packing
  `keys[].pubkey` / `keys[].signature`), producing deposit-contract-valid keys so a subsequent
  `deposit` recipe passes the beacon `DepositContract`. Deferred; tracked separately because the
  deposit-amount semantics on the CSM fork path need their own verification.

## Risks / footguns

- **SK endianness (BE→EIP-2333 vs LE→Herumi).** Mitigated by using `@chainsafe/bls` (handles it) and
  pinned by the golden vector. If we ever drop to raw `bls-eth-wasm`, this reopens.
- **Vendored WithdrawalVault drift.** A redeploy/locator change would silently produce keys the
  widget rejects. Mitigated by the build-time verification note + the round-trip test using the same
  constant (catches an internally-inconsistent value, not an upstream change). A future live `--rpc`
  resolve (deferred option) would self-correct.
- **Mirrored-not-imported constants drift from the SDK.** Caught by the golden vector if the SDK
  changes fork versions/domain; otherwise a known, accepted maintenance cost (csm-lab cannot depend
  on its consumer).
- **`deposit_data_root` is not re-derived by the widget validator** (only the `deposit_message_root`
  and the BLS sig are). We compute it correctly anyway for the real beacon-deposit path (future
  recipes consumer); its correctness is covered by the golden vector, not the widget.
