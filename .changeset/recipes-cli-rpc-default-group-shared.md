---
'@sm-lab/recipes': minor
---

feat(cli): `sm-recipes` now defaults `--rpc-url` to anvil's `http://127.0.0.1:8545` (after
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
