import { binConfig } from '@sm-lab/config/tsdown';

// Bin-only package: the single `cli` entry becomes the `sm-anvil` bin (dist/cli.mjs).
// launch.ts is imported by cli.ts, so it's bundled in — no separate library entry.
export default binConfig({
  entry: {
    cli: 'src/cli.ts',
  },
});
