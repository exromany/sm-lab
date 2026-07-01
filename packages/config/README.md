# @sm-lab/config

Shared, internal-only build/type/lint presets. Not published — consumed via `workspace:*`.

This package is the **single lever** for tooling decisions. Change the dts strategy, output
formats, or compiler options here and every package inherits it on next build.

## Usage

**TypeScript** — each package's `tsconfig.json`:

```json
{ "extends": "@sm-lab/config/tsconfig.lib.json", "compilerOptions": { "outDir": "dist" } }
```

**tsdown** — each package's `tsdown.config.ts`:

```ts
import { libConfig } from '@sm-lab/config/tsdown';
export default libConfig(); // or libConfig({ entry: ['src/index.ts', 'src/cli.ts'] })
```

**oxlint** — configured once at the repo root (`.oxlintrc.json`); no per-package setup.
