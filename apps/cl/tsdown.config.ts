import { libConfig } from '@sm-lab/config/tsdown';

// Object entry keeps the source tree intact (no file moves) while giving distinct,
// predictable output names: dist/index.js (library) + dist/cli.js (the `sm-cl` bin).
// ESM-only + Node platform — faithful to the original `type: module` / tsc setup.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
});
