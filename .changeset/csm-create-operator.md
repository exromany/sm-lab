---
'@sm-lab/recipes': minor
---

`createCsmOperator` recipe + `sm-recipes csm create-operator`: create a CSM node operator with
fresh keys and exact ETH bond through the PermissionlessGate (default) or a vetted gate
(`ics`/`idvtc` — persistently whitelists the address and proves it). CLI gains order-free
positionals (`create-operator idvtc 10` == `create-operator 10 idvtc`) and boolean switch flags;
`addGateAddrs` now returns the post-union allowlist `addresses`.
