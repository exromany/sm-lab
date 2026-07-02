import { libConfig } from '@sm-lab/config/tsdown';

// Entry points → dist/index.mjs + dist/cm.mjs + dist/cli.mjs, matching the "." / "./cm"
// subpath exports. ESM-only + Node, like @sm-lab/merkle. There is no "./csm" subpath: the
// gate recipe (setGateAddrs) is module-agnostic and lives on the root export, and csm's only
// specificity — the ics/idvtc selectors — is resolved via resolveGate (also root-exported).
//
// alwaysBundle is narrowed to the unpublished @sm-lab/core (a devDependency the CLI's
// completion/version helpers come from) so the *published* siblings @sm-lab/receipts,
// @sm-lab/merkle and @sm-lab/keys stay EXTERNAL (the shared libConfig default bundles
// ALL @sm-lab/*). They resolve as normal runtime deps; merkle's @openzeppelin/merkle-tree
// resolves transitively.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cm: 'src/cm/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  deps: {
    alwaysBundle: [/^@sm-lab\/core$/],
    dts: { alwaysBundle: [/^@sm-lab\/core$/] },
  },
});
