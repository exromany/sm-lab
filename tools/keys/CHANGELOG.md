# @sm-lab/keys

## 0.2.1

### Patch Changes

- Updated dependencies [449aa14]
  - @sm-lab/receipts@0.2.0

## 0.2.0

### Minor Changes

- 0067039: feat: @sm-lab/keys — real BLS12-381 deposit-key generator (sm-keys bin + TS API) for mainnet/hoodi, replacing the eth-staking-smith binary
- bed9b0d: feat(cli): `sm-keys` now accepts `count` positionally and a top-level `help` command,
  mirroring the `sm-recipes` CLI. `sm-keys 2` == `sm-keys --count 2` (the positional wins
  when both are given), and `sm-keys help` mirrors `--help`. The `--count` flag and all other
  options are unchanged.
- da93973: feat(cli): `sm-keys` gains a `completion <shell>` command (static bash/zsh/fish scripts, e.g.
  `sm-keys completion fish | source`) and `--version`. `--chain` and `--type` are now validated
  natively via commander choices (invalid values are usage errors; defaults unchanged: `hoodi`,
  `0x01`), and the root help states the stdout/stderr contract (human mode: deposit_data.json to
  stdout or `--out`, mnemonic to stderr). package.json gains `repository` metadata.

### Patch Changes

- 5054cb4: chore(deps): security + dependency maintenance.

  - Patch transitive advisories via pnpm overrides: `ws` >=8.21.0 (GHSA-96hv-2xvq-fx4p, high) and `uuid` >=11.1.1 under `@metamask/utils` (GHSA-w5hq-g745-h8pq, moderate).
  - Bump runtime deps: commander 15, dotenv 17, multiformats 14, @hono/node-server 2, @chainsafe/bls 8.
  - Bump dev toolchain: TypeScript 6, Vitest 4, @types/node 26, prettier 3.9.

- 6e7c8a6: receipts: slim committed address data to a strictly-typed allowlist (drop DeployParams, \*Impl,
  linked libs), and optionally bake LidoLocator-resolved protocol addresses into a `protocol` block
  during `--rpc`-gated refresh (with `manifest.protocolResolvedAt` provenance). recipes `connect()`
  and the keys tool now prefer the baked block and fall back to their previous behavior when absent.
- Updated dependencies [ae31fca]
- Updated dependencies [da93973]
- Updated dependencies [6e7c8a6]
  - @sm-lab/receipts@0.1.0
