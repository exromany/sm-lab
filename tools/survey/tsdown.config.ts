import { libConfig } from '@sm-lab/config/tsdown';

// `dist/cli.mjs` is the published `bin` (Prisma's `prisma-client` generator emits ESM that rolldown
// bundles inline; only @prisma/client, @prisma/adapter-pg and pg stay external as regular
// `dependencies`, since libConfig only force-bundles @sm-lab/*). `dts: false` — nothing imports this
// package's types. `tsx src/*` remains the local-dev convenience path.
export default libConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  dts: false,
});
