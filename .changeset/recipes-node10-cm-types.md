---
'@sm-lab/recipes': patch
---

Add a `typesVersions` shim so the `./cm` subpath's types resolve under legacy
`moduleResolution: node`/`node10` consumers (e.g. csm-widget on TS 5.7). node10
ignores the `exports` map, so subpath declarations were invisible; root imports were
unaffected. `bundler`/`node16`/`nodenext` consumers are unchanged (they keep using
`exports`). Stopgap until consumers move off node10 (removed in TS 7).
