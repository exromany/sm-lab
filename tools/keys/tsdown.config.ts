import { libConfig } from '@sm-lab/config/tsdown';

// dist/index.mjs (library) + dist/cli.mjs (the `sm-keys` bin). ESM-only, Node platform.
//
// Crypto self-containment: @scure/bip39 is pinned at v2 (→ @noble/hashes v2), but the rest of
// the EVM ecosystem this package lives beside (viem/wagmi, all @chainsafe/*) is on @noble/hashes
// v1.x — and the two majors have incompatible module layouts (v2 `sha2.js`/`webcrypto.js` vs v1
// `sha256.js`). A consumer hoisting a single noble would break whichever bip39 got the wrong one.
// So we INLINE the matched bip39/noble/base trio into dist (and drop @scure/bip39 from runtime
// `dependencies`): the published artifact carries no noble/bip39 edge in its tree, immune to
// whatever the consumer hoists. `@scure/base` rides along because bip39 imports it — bundling
// bip39+noble alone would leave a dangling `@scure/base` import against a dep we no longer declare.
//
// `deps` is a full override, so re-list `/^@sm-lab\//` (the libConfig default) to keep workspace
// internals like @sm-lab/core / @sm-lab/receipts bundled.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  deps: {
    alwaysBundle: [
      /^@sm-lab\//,
      /^@scure\/bip39(\/|$)/,
      /^@scure\/base(\/|$)/,
      /^@noble\/hashes(\/|$)/,
    ],
    dts: { alwaysBundle: [/^@sm-lab\//] },
  },
});
