import { libConfig } from '@sm-lab/config/tsdown';

// Object entry keeps the source tree intact while emitting two predictable outputs:
// dist/index.mjs (library) + dist/cli.mjs (the `sm-merkle` bin).
export default libConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  platform: 'node',
});
