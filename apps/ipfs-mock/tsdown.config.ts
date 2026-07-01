import { libConfig } from '@sm-lab/config/tsdown';

// Object entry keeps the source tree intact while giving predictable output names:
// dist/index.mjs (library) + dist/cli.mjs (the `csm-ipfs-mock` bin). ESM-only + Node platform.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
});
