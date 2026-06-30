---
'@csm-lab/keys': minor
---

feat(cli): `csm-keys` now accepts `count` positionally and a top-level `help` command,
mirroring the `csm-recipes` CLI. `csm-keys 2` == `csm-keys --count 2` (the positional wins
when both are given), and `csm-keys help` mirrors `--help`. The `--count` flag and all other
options are unchanged.
