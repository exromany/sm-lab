import { libConfig } from '@csm-lab/config/tsdown';

// dist/index.mjs (library) + dist/cli.mjs (the `csm-keys` bin). ESM-only, Node platform.
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
});
