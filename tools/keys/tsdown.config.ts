import { libConfig } from '@sm-lab/config/tsdown';

// dist/index.mjs (library) + dist/cli.mjs (the `sm-keys` bin). ESM-only, Node platform.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
});
