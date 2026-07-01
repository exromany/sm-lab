import { libConfig } from '@sm-lab/config/tsdown';

// Three entry points → dist/index.mjs + dist/cm.mjs + dist/csm.mjs, matching the
// "." / "./cm" / "./csm" subpath exports. ESM-only + Node, like @sm-lab/merkle.
//
// alwaysBundle is overridden to [] so the *published* siblings @sm-lab/receipts and
// @sm-lab/merkle stay EXTERNAL (the shared libConfig default bundles all @sm-lab/* —
// that is meant for the unpublished @sm-lab/core only). They resolve as normal runtime
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
