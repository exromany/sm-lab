---
'@sm-lab/keys': minor
---

feat(cli): `sm-keys` now accepts `count` positionally and a top-level `help` command,
mirroring the `sm-recipes` CLI. `sm-keys 2` == `sm-keys --count 2` (the positional wins
when both are given), and `sm-keys help` mirrors `--help`. The `--count` flag and all other
options are unchanged.
