import { libConfig } from '@sm-lab/config/tsdown';

// Private, unpublished tool. The real run path is `tsx src/cli.ts`; this build exists only for
// `pnpm turbo run build` consistency. @prisma/client, @prisma/adapter-pg and pg are regular
// `dependencies`, so tsdown externalizes them by default (libConfig only force-bundles @sm-lab/*).
// `dts: false` — nothing imports this package's types.
export default libConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  dts: false,
});
