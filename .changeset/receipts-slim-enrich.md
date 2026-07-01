---
'@sm-lab/receipts': minor
'@sm-lab/recipes': patch
'@sm-lab/keys': patch
---

receipts: slim committed address data to a strictly-typed allowlist (drop DeployParams, \*Impl,
linked libs), and optionally bake LidoLocator-resolved protocol addresses into a `protocol` block
during `--rpc`-gated refresh (with `manifest.protocolResolvedAt` provenance). recipes `connect()`
and the keys tool now prefer the baked block and fall back to their previous behavior when absent.
