import { libConfig } from '@csm-lab/config/tsdown';

// Three entry points → dist/index.mjs + dist/cm.mjs + dist/csm.mjs, matching the
// "." / "./cm" / "./csm" subpath exports. ESM-only + Node, like @csm-lab/merkle.
//
// alwaysBundle is overridden to [] so the *published* siblings @csm-lab/receipts and
// @csm-lab/merkle stay EXTERNAL (the shared libConfig default bundles all @csm-lab/* —
// that is meant for the unpublished @csm-lab/core only). They resolve as normal runtime
// deps; merkle's @openzeppelin/merkle-tree resolves transitively.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cm: 'src/cm/index.ts',
    csm: 'src/csm/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  deps: {
    alwaysBundle: [],
    dts: { alwaysBundle: [] },
  },
});
