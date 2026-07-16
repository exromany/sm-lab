---
'@sm-lab/keys': patch
---

Bundle `@scure/bip39` (+ its `@noble/hashes` v2 and `@scure/base`) into the published `dist/`
instead of shipping them as runtime deps. `@scure/bip39@2` pulls `@noble/hashes@2`, whose module
layout is incompatible with the `@noble/hashes@1.8.0` the rest of the EVM ecosystem (viem/wagmi,
`@chainsafe/*`) resolves — a consumer hoisting a single noble version would break whichever bip39
got the wrong one. Inlining the matched trio makes the artifact self-contained: `@sm-lab/keys` no
longer contributes any `@noble/hashes`/`@scure/*` edge to a consumer's tree, so it's immune to
hoisting. No API change.
