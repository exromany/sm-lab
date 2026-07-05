---
'@sm-lab/recipes': minor
---

Add the `exit-request` recipe + CLI command: submit a single validator-exit request to the
Validators Exit Bus Oracle (VEBO) by impersonating its consensus contract and a `SUBMIT_DATA_ROLE`
holder. Module-agnostic (csm + cm); auto-mirrored under the `csm`/`cm` CLI groups.
`sm-recipes exit-request <operator-id> <key-index> [--validator-index n]`.
