# Survey Seed CLI (`@sm-lab/survey`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a run-and-exit CLI (`sm-survey <group> <cmd>`) in sm-lab that seeds the survey-api Postgres into arbitrary states for local dev / widget testing by writing rows directly via a vendored Prisma client.

**Architecture:** A new `tools/survey` package (`@sm-lab/survey`, private/unpublished) mirroring `tools/recipes`' shape: a commander program assembled by a declarative registry (`SeedCommand` descriptors + one `defineCommand` factory + `buildProgram(prisma, commands)`), universal `--json`, and a single injected `PrismaClient` as the sole test seam. sm-lab vendors a **generate-only** copy of survey-api's `schema.prisma` and generates its own client (never migrates). The CLI replicates the DB + service invariants (single-active form; rotation supersede; rotation **approve → mergeSlots → `ActiveMembers` upsert**; 4-slot padding on first init; IDVTC bind = `issued` + `boundToNodeOperatorId`, APPROVED-only; slot address↔signature pairing; address casing) by copying the real service transactions — identical Prisma calls.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, extensionless imports), Prisma 7 `prisma-client` generator (ESM output) + `@prisma/adapter-pg` + `pg`, viem (`viem/accounts`), commander, dotenv, tsx, tsdown, vitest + vitest-mock-extended.

## Global Constraints

- **Node ≥ 24.** ESM (`type: module`), `moduleResolution: Bundler`. Write **extensionless** imports
  (`from './gen'`), `import type` for type-only. NEVER `from './x.js'` (breaks Vitest resolution).
- **Vendored Prisma is generate-only.** Never run `prisma migrate` in sm-lab. The survey-api-owned DB
  already has all constraints. The vendored `schema.prisma` differs from survey-api's only in the
  `generator`/`datasource` blocks.
- **Import the generated client through `src/db.ts`** (`export * from './generated/prisma/client'`), so
  every module imports `PrismaClient`, enums, and `Prisma` from `../db` / `./db` — one place owns the
  generated path. The generated dir is git-ignored.
- **Addresses lowercased on write** (matches the services); validate user-supplied addresses with viem
  `getAddress` first (throws on invalid).
- **`--json` contract:** with `--json`, print exactly ONE JSON value to stdout (`JSON.stringify(v,
  replacer, 2)`, bigint→string). No other stdout logging in json mode. Errors → `Error: <msg>` on
  stderr, `process.exitCode = 1`. Success exit 0.
- **Enum values passed to Prisma are PSL names** (`'APPROVED'`), Prisma maps them to lowercase DB values.
  CLI `--status` accepts lowercase and coerces.
- **Private package** (`"private": true`), no npm publish, no changeset. Local run path is `tsx`
  (`pnpm --filter @sm-lab/survey exec tsx src/cli.ts …` or the `survey` script). tsdown build exists for
  turbo, externalizing `@prisma/client`/`@prisma/adapter-pg`/`pg`.
- **Per-package gates:** `pnpm --filter @sm-lab/survey generate` (once, before typecheck) · `types`
  (`tsc --noEmit`) · `test` (`vitest run`) · `build` (`tsdown`) · `oxlint tools/survey/src` ·
  `prettier --check "tools/survey/**/*.{ts,json}"`.
- **Commits `--no-gpg-sign`** (maintainer signs the final push).

## File Structure

- `pnpm-workspace.yaml` — add catalog entries (modify).
- `tools/survey/package.json` — `@sm-lab/survey` manifest (create).
- `tools/survey/tsconfig.json` — relative-extends config (create).
- `tools/survey/tsdown.config.ts` — build entry, prisma/pg external (create).
- `tools/survey/prisma.config.ts` — schema path for `prisma generate` (create).
- `tools/survey/prisma/schema.prisma` — vendored, generate-only (create).
- `tools/survey/prisma/manifest.json` — vendoring provenance (create, written by refresh).
- `tools/survey/.gitignore` — ignore `src/generated/` (create).
- `tools/survey/src/refresh.ts` — re-vendor + regenerate + record provenance (create).
- `tools/survey/src/db.ts` — re-export generated client (create).
- `tools/survey/src/prisma.ts` — `createPrisma(url)` (create).
- `tools/survey/src/gen.ts` — address/signature generators (create).
- `tools/survey/src/define.ts` — `SeedCommand`/`OptionSpec`, coercers, `defineCommand`, `buildProgram` (create).
- `tools/survey/src/commands/*.ts` — one file per group + `index.ts` (`ALL_COMMANDS`) (create).
- `tools/survey/src/cli.ts` — bootstrap (create).
- `tools/survey/test/*.test.ts` — vitest suites (create).
- `tools/survey/README.md` — usage + sync procedure (create).
- root `CLAUDE.md` — `@sm-lab/survey` status bullet (modify).

---

## Task 0: Scaffold `@sm-lab/survey` — package, vendored schema, generate, refresh

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog)
- Create: `tools/survey/package.json`, `tsconfig.json`, `tsdown.config.ts`, `prisma.config.ts`,
  `prisma/schema.prisma`, `.gitignore`, `src/refresh.ts`, `src/db.ts`

**Interfaces:**
- Produces: a buildable/generatable package; `src/db.ts` re-exporting `PrismaClient`, `Prisma`, and
  enums (`IcsFormStatus`, `IdvtcFormStatus`, `RotationRequestStatus`, `AdminRole`) from the generated client.

- [ ] **Step 1: Add catalog entries**

In `pnpm-workspace.yaml` `catalog:`, add (keep the file's grouping style):

```yaml
  # survey-api DB tooling (@sm-lab/survey)
  prisma: ^7.0.0
  '@prisma/client': ^7.0.0
  '@prisma/adapter-pg': ^7.0.0
  pg: ^8.13.0
  '@types/pg': ^8.11.0
  vitest-mock-extended: ^3.1.0
```

> Match the exact `prisma`/`@prisma/*` version survey-api resolves (check its `pnpm-lock.yaml`); pin the
> same major.minor to keep the generated client compatible. As of 2026-07-21 survey-api resolves
> **7.8.0** — use `~7.8.0` for `prisma`/`@prisma/client`/`@prisma/adapter-pg` (re-check before pinning).

- [ ] **Step 2: Create `tools/survey/package.json`**

```json
{
  "name": "@sm-lab/survey",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Direct-DB seed CLI for the Lido CSM survey-api (local dev / widget testing)",
  "license": "MIT",
  "scripts": {
    "generate": "prisma generate",
    "prebuild": "prisma generate",
    "build": "tsdown",
    "survey": "tsx src/cli.ts",
    "refresh": "tsx src/refresh.ts",
    "test": "vitest run",
    "types": "tsc --noEmit"
  },
  "dependencies": {
    "@prisma/adapter-pg": "catalog:",
    "@prisma/client": "catalog:",
    "commander": "catalog:",
    "dotenv": "catalog:",
    "pg": "catalog:",
    "viem": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/pg": "catalog:",
    "prisma": "catalog:",
    "tsdown": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "vitest-mock-extended": "catalog:"
  },
  "engines": { "node": ">=24" }
}
```

- [ ] **Step 3: Create `tools/survey/tsconfig.json`**

```json
{
  "comment": "Relative extends, not the @sm-lab/config subpath — tsdown's Rust tsconfig loader doesn't follow package-exports extends. typecheck-only (--noEmit). include covers test/** and the generated client.",
  "extends": "../../packages/config/tsconfig.lib.json",
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `tools/survey/tsdown.config.ts`**

```ts
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
```

> Inspect `packages/config/tsdown.base.ts` first to confirm `libConfig` forwards `dts`. If it doesn't,
> pass `dts: false` isn't possible — instead accept the default dts emit; should it fail on the
> generated client, exclude the entry's dts or drop the `build` script entirely (the tool runs via
> `tsx`, so a build is optional — note that in `package.json` by removing `build`/`prebuild` if so).

- [ ] **Step 5: Create `tools/survey/prisma.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({ schema: 'prisma/schema.prisma' });
```

- [ ] **Step 6: Create `tools/survey/.gitignore`**

```
src/generated/
```

- [ ] **Step 7: Vendor the schema (manually for the first bootstrap)**

Copy survey-api's `prisma/schema.prisma` body into `tools/survey/prisma/schema.prisma`, replacing the
`generator`/`datasource` blocks with sm-lab's. The head of the file must be exactly:

```prisma
generator client {
  provider            = "prisma-client"
  output              = "./../src/generated/prisma"
  runtime             = "nodejs"
  moduleFormat        = "esm"
  importFileExtension = ""
}

datasource db {
  provider     = "postgresql"
  url          = env("DATABASE_URL")
  relationMode = "prisma"
}
```

Then paste **all** `model` and `enum` blocks from survey-api's schema verbatim (Contacts, Experience,
HowDidYouLearnCsm, Setup, SetupSnapshot, Delegate, IcsForm, IcsFormReview, IdvtcForm, IdvtcFormReview,
AdminUser, OperatorFile, ActiveMembers, RotationRequest + the three status enums + AdminRole). Do not
edit the model bodies — Step 9's `refresh.ts` automates this copy going forward.

- [ ] **Step 8: Install, generate, and create `src/db.ts`**

Run: `pnpm install` (never concurrently with another install).
Run: `pnpm --filter @sm-lab/survey generate`
Expected: writes `tools/survey/src/generated/prisma/*`.

Create `tools/survey/src/db.ts`:

```ts
// Single owner of the generated-client path. Everything else imports from here.
export * from './generated/prisma/client';
```

- [ ] **Step 9: Create `tools/survey/src/refresh.ts`**

```ts
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vendored generator/datasource header prepended to survey-api's model/enum bodies.
const HEADER = `generator client {
  provider            = "prisma-client"
  output              = "./../src/generated/prisma"
  runtime             = "nodejs"
  moduleFormat        = "esm"
  importFileExtension = ""
}

datasource db {
  provider     = "postgresql"
  url          = env("DATABASE_URL")
  relationMode = "prisma"
}
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const source = arg('source') ?? process.env.SURVEY_API_PATH;
  const force = process.argv.includes('--force');
  if (!source) throw new Error('Provide survey-api path via --source <path> or SURVEY_API_PATH');

  // Guard: source working tree must be clean so the recorded commit is meaningful.
  const dirty = execFileSync('git', ['-C', source, 'status', '--porcelain']).toString().trim();
  if (dirty && !force) throw new Error(`Source working tree is dirty; commit or pass --force`);
  const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD']).toString().trim();
  const ref = execFileSync('git', ['-C', source, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();

  const srcSchema = readFileSync(resolve(source, 'prisma/schema.prisma'), 'utf8');
  // Drop everything up to and including the source datasource block; keep models/enums.
  const bodyStart = srcSchema.search(/^(model|enum)\s/m);
  if (bodyStart < 0) throw new Error('No model/enum blocks found in source schema');
  const body = srcSchema.slice(bodyStart);
  writeFileSync(resolve('prisma/schema.prisma'), HEADER + '\n' + body);

  execFileSync('pnpm', ['prisma', 'generate'], { stdio: 'inherit' });

  writeFileSync(
    resolve('prisma/manifest.json'),
    JSON.stringify({ sourceRef: ref, sourceCommit: commit, refreshedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  console.log(`Refreshed schema from ${source} @ ${ref} (${commit.slice(0, 8)})`);
}

main();
```

- [ ] **Step 10: Verify baseline**

Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors (typechecks the generated client via `src/db.ts`).
Run: `git status --short tools/survey` → Expected: `src/generated/` NOT listed (ignored).

- [ ] **Step 11: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml tools/survey/package.json tools/survey/tsconfig.json \
  tools/survey/tsdown.config.ts tools/survey/prisma.config.ts tools/survey/prisma/schema.prisma \
  tools/survey/prisma/manifest.json tools/survey/.gitignore tools/survey/src/refresh.ts tools/survey/src/db.ts
git commit --no-gpg-sign -m "feat(survey): scaffold @sm-lab/survey — vendored schema, generate, refresh"
```

---

## Task 1: Generators + Prisma client factory

**Files:**
- Create: `tools/survey/src/gen.ts`, `tools/survey/src/prisma.ts`
- Test: `tools/survey/test/gen.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` from `../db` (Task 0).
- Produces:
  - `randomAddress(): string`, `placeholderSignature(): string`, `assertAddress(v: string): string`,
    `resolveAddress(explicit?: string): string`
  - `createPrisma(connectionString: string): PrismaClient`

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/gen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { randomAddress, placeholderSignature, resolveAddress, assertAddress } from '../src/gen';

describe('gen', () => {
  it('randomAddress: lowercased valid 42-char address', () => {
    const a = randomAddress();
    expect(a).toMatch(/^0x[0-9a-f]{40}$/);
    expect(getAddress(a)).toBeDefined();
  });
  it('randomAddress: distinct across calls', () => {
    expect(randomAddress()).not.toEqual(randomAddress());
  });
  it('placeholderSignature: 65-byte hex', () => {
    expect(placeholderSignature()).toMatch(/^0x[0-9a-f]{130}$/);
  });
  it('resolveAddress: lowercases explicit checksum address', () => {
    const c = getAddress('0x' + '1'.repeat(40));
    expect(resolveAddress(c)).toEqual(c.toLowerCase());
  });
  it('resolveAddress: random when none given', () => {
    expect(resolveAddress()).toMatch(/^0x[0-9a-f]{40}$/);
  });
  it('assertAddress: throws on malformed', () => {
    expect(() => assertAddress('0xnope')).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test gen`
Expected: FAIL — cannot resolve `../src/gen`.

- [ ] **Step 3: Implement `src/gen.ts`**

```ts
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export function randomAddress(): string {
  return privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
}

export function placeholderSignature(): string {
  return '0x' + '00'.repeat(65);
}

export function assertAddress(value: string): string {
  return getAddress(value).toLowerCase();
}

export function resolveAddress(explicit?: string): string {
  return explicit ? assertAddress(explicit) : randomAddress();
}
```

- [ ] **Step 4: Implement `src/prisma.ts`**

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from './db';

const DEFAULT_POOL_MAX = 10;

/** Standalone PrismaClient over a pg pool. Caller owns lifecycle; call `$disconnect()` when done. */
export function createPrisma(connectionString: string): PrismaClient {
  const url = new URL(connectionString);
  const limit = url.searchParams.get('connection_limit');
  url.searchParams.delete('connection_limit');
  const max = limit !== null ? Number(limit) : DEFAULT_POOL_MAX;
  const pool = new Pool({ connectionString: url.toString(), max });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
```

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test gen` → Expected: PASS (6).
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/gen.ts tools/survey/src/prisma.ts tools/survey/test/gen.test.ts
git commit --no-gpg-sign -m "feat(survey): address/signature generators + prisma client factory"
```

---

## Task 2: Command framework — `defineCommand`, coercers, `buildProgram`, bootstrap

**Files:**
- Create: `tools/survey/src/define.ts`, `src/commands/index.ts`, `src/cli.ts`
- Test: `tools/survey/test/define.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` from `./db`; `assertAddress` from `./gen`.
- Produces:
  - `type OptionSpec = { flag: string; desc: string; coerce?: (raw: string, prev?: unknown) => unknown; repeatable?: boolean; kv?: boolean }`
  - `type SeedCommand = { group: string; name: string; summary: string; argument?: { name: string; desc: string; prop: string }; options: OptionSpec[]; run(prisma: PrismaClient, args: Record<string, unknown>): Promise<unknown> }`
  - `toAddress`, `toStatus`, `toInt`, `toKv`, `jsonReplacer`, `defineCommand(desc, prisma)`, `buildProgram(prisma, commands)`

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/define.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram, toKv, toStatus, type SeedCommand } from '../src/define';

const echo: SeedCommand = {
  group: 'demo', name: 'echo', summary: 'echo',
  options: [
    { flag: '--name <s>', desc: 'name' },
    { flag: '--tag <kv...>', desc: 'k=v', repeatable: true, kv: true },
  ],
  run: async (_p, args) => ({ ok: true, args }),
};

describe('toKv', () => {
  it('accumulates pairs', () => {
    const acc = toKv('a=1', undefined);
    expect(toKv('b=two', acc)).toEqual({ a: '1', b: 'two' });
  });
  it('throws without =', () => expect(() => toKv('bad', undefined)).toThrow());
});

describe('toStatus', () => {
  it('maps to PSL name', () => expect(toStatus('approved')).toBe('APPROVED'));
  it('throws on unknown', () => expect(() => toStatus('pending')).toThrow());
});

describe('buildProgram', () => {
  it('prints one JSON value with --json', async () => {
    const prisma = mockDeep<PrismaClient>();
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s?: unknown) => void out.push(String(s)));
    await buildProgram(prisma, [echo]).parseAsync(['demo', 'echo', '--name', 'x', '--tag', 'a=1', '--json'], { from: 'user' });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ ok: true, args: { name: 'x', tag: { a: '1' }, json: true } });
    vi.restoreAllMocks();
  });

  it('exit 1 + Error: on throw', async () => {
    const prisma = mockDeep<PrismaClient>();
    const boom: SeedCommand = { group: 'demo', name: 'boom', summary: '', options: [], run: async () => { throw new Error('kaboom'); } };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await buildProgram(prisma, [boom]).parseAsync(['demo', 'boom'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('Error: kaboom'));
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test define`
Expected: FAIL — cannot resolve `../src/define`.

- [ ] **Step 3: Implement `src/define.ts`**

```ts
import { Command } from 'commander';
import type { PrismaClient } from './db';
import { assertAddress } from './gen';

export type OptionSpec = {
  flag: string;
  desc: string;
  coerce?: (raw: string, prev?: unknown) => unknown;
  repeatable?: boolean;
  kv?: boolean;
};

export type SeedCommand = {
  group: string;
  name: string;
  summary: string;
  argument?: { name: string; desc: string; prop: string };
  options: OptionSpec[];
  run(prisma: PrismaClient, args: Record<string, unknown>): Promise<unknown>;
};

const STATUSES = ['REVIEW', 'APPROVED', 'REJECTED'] as const;
export type StatusName = (typeof STATUSES)[number];

export function toAddress(raw: string): string {
  return assertAddress(raw);
}

export function toStatus(raw: string): StatusName {
  const upper = raw.toUpperCase();
  if (!STATUSES.includes(upper as StatusName)) {
    throw new Error(`Invalid status '${raw}' (expected review|approved|rejected)`);
  }
  return upper as StatusName;
}

export function toInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, got '${raw}'`);
  return n;
}

export function toKv(raw: string, prev?: Record<string, string>): Record<string, string> {
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new Error(`Expected field=value, got '${raw}'`);
  const acc = prev ?? {};
  acc[raw.slice(0, eq)] = raw.slice(eq + 1);
  return acc;
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function printResult(result: unknown, json: boolean): void {
  console.log(typeof result === 'string' && !json ? result : JSON.stringify(result, jsonReplacer, 2));
}

export function defineCommand(desc: SeedCommand, prisma: PrismaClient): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  if (desc.argument) cmd.argument(`<${desc.argument.name}>`, desc.argument.desc);
  for (const opt of desc.options) {
    if (opt.kv || opt.repeatable) {
      cmd.option(opt.flag, opt.desc, (raw: string, prev: unknown) =>
        opt.kv
          ? toKv(raw, prev as Record<string, string>)
          : [...((prev as unknown[]) ?? []), opt.coerce ? opt.coerce(raw) : raw],
      );
    } else if (opt.coerce) {
      cmd.option(opt.flag, opt.desc, opt.coerce);
    } else {
      cmd.option(opt.flag, opt.desc);
    }
  }
  cmd.option('--json', 'emit machine-readable JSON');
  cmd.action(async (...actionArgs: unknown[]) => {
    // commander passes positionals first, then the options object, then the Command instance.
    const opts = actionArgs[actionArgs.length - 2] as Record<string, unknown>;
    if (desc.argument) opts[desc.argument.prop] = actionArgs[0];
    try {
      const result = await desc.run(prisma, opts);
      printResult(result, Boolean(opts.json));
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });
  return cmd;
}

export function buildProgram(prisma: PrismaClient, commands: SeedCommand[]): Command {
  const program = new Command('sm-survey').description('survey-api seed CLI');
  const groups = new Map<string, Command>();
  for (const desc of commands) {
    if (desc.group === 'root') {
      program.addCommand(defineCommand(desc, prisma)); // top-level: `sm-survey reset`, `scenario`
      continue;
    }
    if (!groups.has(desc.group)) groups.set(desc.group, new Command(desc.group).description(`${desc.group} commands`));
    groups.get(desc.group)!.addCommand(defineCommand(desc, prisma));
  }
  for (const g of groups.values()) program.addCommand(g);
  return program;
}
```

- [ ] **Step 4: Create the registry and bootstrap**

Create `tools/survey/src/commands/index.ts`:

```ts
import type { SeedCommand } from '../define';

// Appended to by each command-family task.
export const ALL_COMMANDS: SeedCommand[] = [];
```

Create `tools/survey/src/cli.ts`:

```ts
import 'dotenv/config';
import { ALL_COMMANDS } from './commands';
import { buildProgram } from './define';
import { createPrisma } from './prisma';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = createPrisma(url);
  try {
    await buildProgram(prisma, ALL_COMMANDS).parseAsync(process.argv);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
```

- [ ] **Step 5: Run to verify green + smoke**

Run: `pnpm --filter @sm-lab/survey test define` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.
Run: `pnpm --filter @sm-lab/survey exec tsx src/cli.ts --help`
Expected: prints program help (no groups yet); exit 0. (Requires `DATABASE_URL` set — `--help` short-circuits before the DB is used, but if it errors on the env check, set a dummy `DATABASE_URL` in `.env`.)

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/define.ts tools/survey/src/commands/index.ts tools/survey/src/cli.ts tools/survey/test/define.test.ts
git commit --no-gpg-sign -m "feat(survey): command framework — defineCommand, coercers, buildProgram"
```

---

## Task 3: ICS commands (`ics seed`, `ics review`)

**Files:**
- Create: `tools/survey/src/commands/ics.ts`
- Modify: `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/ics.test.ts`

**Interfaces:**
- Consumes: `SeedCommand`, `toAddress`, `toStatus`; `resolveAddress`; `IcsFormStatus` from `../db`.
- Produces: `icsCommands: SeedCommand[]`; `ICS_COMMENTS`, `ICS_POINTS`, `mapFields`, `resolveReviewerId`.

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/ics.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { icsCommands } from '../src/commands/ics';

const A1 = '0x' + '1'.repeat(40);
const A2 = '0x' + '2'.repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, icsCommands).parseAsync(argv, { from: 'user' });
}

describe('ics seed', () => {
  it('marks prior forms outdated then creates with the given status', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.icsForm.create.mockResolvedValue({ id: 17 } as any);
    await run(prisma, ['ics', 'seed', '--operator', '42', '--status', 'approved', '--main-address', A1]);
    expect(tx.icsForm.updateMany).toHaveBeenCalledWith({ where: { mainAddress: A1 }, data: { outdated: true } });
    const arg = tx.icsForm.create.mock.calls[0][0];
    expect(arg.data.mainAddress).toBe(A1);
    expect(arg.data.review.create.status).toBe('APPROVED');
  });
});

describe('ics review', () => {
  it('updates the active form review with status/comments/points', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    await run(prisma, ['ics', 'review', '--main-address', A2, '--status', 'rejected', '--comment', 'mainAddress=bad', '--points', 'ethStaker=3']);
    expect(prisma.icsForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mainAddress: A2, outdated: false } }),
    );
    expect(prisma.icsFormReview.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ status: 'REJECTED', mainAddressComment: 'bad', ethStakerPoints: 3 }),
    });
  });

  it('errors when no active form exists', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue(null as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['ics', 'review', '--main-address', '0x' + '3'.repeat(40), '--status', 'approved']);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('marks the form issued with --issued (approved only)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    await run(prisma, ['ics', 'review', '--main-address', A2, '--status', 'approved', '--issued']);
    expect(prisma.icsForm.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { issued: true } });
  });

  it('rejects --issued without --status approved', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['ics', 'review', '--main-address', A2, '--status', 'rejected', '--issued']);
    expect(process.exitCode).toBe(1);
    expect(prisma.icsForm.update).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test ics`
Expected: FAIL — cannot resolve `../src/commands/ics`.

- [ ] **Step 3: Implement `src/commands/ics.ts`**

```ts
import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import { IcsFormStatus } from '../db';

export const ICS_COMMENTS: Record<string, string> = {
  reason: 'comment', mainAddress: 'mainAddressComment', twitterLink: 'twitterLinkComment',
  discordLink: 'discordLinkComment', additional1: 'additionalComment1', additional2: 'additionalComment2',
  additional3: 'additionalComment3', additional4: 'additionalComment4', additional5: 'additionalComment5',
};

export const ICS_POINTS: Record<string, string> = {
  ethStaker: 'ethStakerPoints', stakeCat: 'stakeCatPoints', obolTechne: 'obolTechnePoints',
  ssvVerified: 'ssvVerifiedPoints', csmTestnet: 'csmTestnetPoints', csmMainnet: 'csmMainnetPoints',
  sdvtTestnet: 'sdvtTestnetPoints', sdvtMainnet: 'sdvtMainnetPoints', humanPassport: 'humanPassportPoints',
  circles: 'circlesPoints', discord: 'discordPoints', twitter: 'twitterPoints', ssvHumanity: 'ssvHumanityPoints',
  aragonVotes: 'aragonVotesPoints', snapshotVotes: 'snapshotVotesPoints', lidoGalxe: 'lidoGalxePoints',
  highSignal: 'highSignalPoints', gitPoaps: 'gitPoapsPoints',
};

/** Map {cliKey: value} → {column: transformed}, rejecting unknown keys. */
export function mapFields<T>(
  input: Record<string, string> | undefined,
  fieldMap: Record<string, string>,
  transform: (raw: string) => T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const col = fieldMap[k];
    if (!col) throw new Error(`Unknown field '${k}' (expected: ${Object.keys(fieldMap).join(', ')})`);
    out[col] = transform(v);
  }
  return out;
}

/** Create-if-missing an AdminUser for a reviewer address; return its id, or undefined. */
export async function resolveReviewerId(
  prisma: { adminUser: { upsert: (a: unknown) => Promise<{ id: number }> } },
  address?: string,
): Promise<number | undefined> {
  if (!address) return undefined;
  const row = await prisma.adminUser.upsert({ where: { address }, create: { address, role: 'REVIEWER' }, update: {} });
  return row.id;
}

export const icsCommands: SeedCommand[] = [
  {
    group: 'ics',
    name: 'seed',
    summary: 'Create an ICS form for an address in any status',
    options: [
      { flag: '--operator <id>', desc: 'node operator id (informational for ICS)' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--main-address <a>', desc: 'main address (random if omitted)', coerce: toAddress },
      { flag: '--twitter <s>', desc: 'twitter link' },
      { flag: '--discord <s>', desc: 'discord link' },
      { flag: '--additional <a...>', desc: 'additional address', repeatable: true, coerce: toAddress },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      { flag: '--points <kv...>', desc: 'field=n proof score', repeatable: true, kv: true },
    ],
    run: async (prisma, args) => {
      const mainAddress = resolveAddress(args.mainAddress as string | undefined);
      const status = (args.status as string | undefined) ?? IcsFormStatus.REVIEW;
      const additional = (args.additional as string[] | undefined) ?? [];
      const reviewData: Record<string, unknown> = {
        status,
        ...mapFields(args.comment as Record<string, string>, ICS_COMMENTS, (s) => s || null),
        ...mapFields(args.points as Record<string, string>, ICS_POINTS, (s) => Number(s)),
      };
      const formData: Record<string, unknown> = {
        mainAddress,
        twitterLink: (args.twitter as string) ?? null,
        discordLink: (args.discord as string) ?? null,
      };
      additional.slice(0, 5).forEach((addr, i) => {
        formData[`additionalAddress${i + 1}`] = addr;
        formData[`additionalSignature${i + 1}`] = placeholderSignature();
      });
      const created = await prisma.$transaction(async (tx) => {
        await tx.icsForm.updateMany({ where: { mainAddress }, data: { outdated: true } });
        return tx.icsForm.create({ data: { ...formData, review: { create: reviewData } } as never, include: { review: true } });
      });
      return { entity: 'ics', action: 'seed', operator: args.operator ?? null, mainAddress, status, form: created };
    },
  },
  {
    group: 'ics',
    name: 'review',
    summary: 'Update the active ICS form review (status/comments/points)',
    options: [
      { flag: '--main-address <a>', desc: 'main address of the form', coerce: toAddress },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      { flag: '--points <kv...>', desc: 'field=n proof score', repeatable: true, kv: true },
      { flag: '--reviewer <a>', desc: 'reviewer admin address (create-if-missing)', coerce: toAddress },
      { flag: '--issued', desc: 'mark the proof issued on the form (requires --status approved)' },
    ],
    run: async (prisma, args) => {
      const mainAddress = args.mainAddress as string;
      if (!mainAddress) throw new Error('--main-address is required');
      // issued is an explicit admin action in the real system, APPROVED-only (locks the review).
      const issued = Boolean(args.issued);
      if (issued && args.status !== IcsFormStatus.APPROVED) {
        throw new Error('--issued requires --status approved (proofs are only issued for approved forms)');
      }
      const form = await prisma.icsForm.findFirst({ where: { mainAddress, outdated: false }, include: { review: true } });
      if (!form || !form.review) throw new Error(`No active ICS form for ${mainAddress}`);
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const data: Record<string, unknown> = {
        ...(args.status ? { status: args.status } : {}),
        ...(lastReviewerId !== undefined ? { lastReviewerId } : {}),
        ...mapFields(args.comment as Record<string, string>, ICS_COMMENTS, (s) => s || null),
        ...mapFields(args.points as Record<string, string>, ICS_POINTS, (s) => Number(s)),
      };
      const updated = await prisma.icsFormReview.update({ where: { id: form.review.id }, data: data as never });
      if (issued) await prisma.icsForm.update({ where: { id: form.id }, data: { issued: true } });
      return { entity: 'ics', action: 'review', mainAddress, ...(issued ? { issued: true } : {}), review: updated };
    },
  },
];
```

- [ ] **Step 4: Register**

Modify `tools/survey/src/commands/index.ts`:

```ts
import type { SeedCommand } from '../define';
import { icsCommands } from './ics';

export const ALL_COMMANDS: SeedCommand[] = [...icsCommands];
```

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test ics` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/commands/ics.ts tools/survey/src/commands/index.ts tools/survey/test/ics.test.ts
git commit --no-gpg-sign -m "feat(survey): ics seed + review commands"
```

---

## Task 4: IDVTC commands (`idvtc seed`, `idvtc review`)

**Files:**
- Create: `tools/survey/src/commands/idvtc.ts`
- Modify: `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/idvtc.test.ts`

**Interfaces:**
- Consumes: `SeedCommand`, `toAddress`, `toStatus`; `resolveAddress`, `placeholderSignature`;
  `mapFields`, `resolveReviewerId` (from `./ics`); `IdvtcFormStatus` from `../db`.
- Produces: `idvtcCommands: SeedCommand[]`; `IDVTC_COMMENTS`.

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/idvtc.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { idvtcCommands } from '../src/commands/idvtc';

const A1 = '0x' + '1'.repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, idvtcCommands).parseAsync(argv, { from: 'user' });
}

describe('idvtc seed', () => {
  it('supersedes prior forms, creates 4-member form, binds (issued + bound) with --bind', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 3 } as any);
    await run(prisma, ['idvtc', 'seed', '--operator', '7', '--status', 'approved', '--bind', '--main-address', A1]);
    expect(tx.idvtcForm.updateMany).toHaveBeenCalledWith({ where: { mainAddress: A1 }, data: { outdated: true } });
    const data = tx.idvtcForm.create.mock.calls[0][0].data;
    expect(data.boundToNodeOperatorId).toBe('7');
    expect(data.issued).toBe(true); // real initFromIdvtc sets issued + bound atomically
    expect(data.clusterAddress1).toMatch(/^0x[0-9a-f]{40}$/);
    expect(data.clusterSignature1).toBe('0x' + '00'.repeat(65));
    expect(data.review.create.status).toBe('APPROVED');
  });

  it('leaves boundToNodeOperatorId null and issued unset without --bind', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 4 } as any);
    await run(prisma, ['idvtc', 'seed', '--operator', '7']);
    const data = tx.idvtcForm.create.mock.calls[0][0].data;
    expect(data.boundToNodeOperatorId).toBeNull();
    expect(data.issued).toBeUndefined();
  });

  it('defaults to APPROVED with --bind and rejects an explicit non-approved status', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 5 } as any);
    await run(prisma, ['idvtc', 'seed', '--operator', '7', '--bind']);
    expect(tx.idvtcForm.create.mock.calls[0][0].data.review.create.status).toBe('APPROVED');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['idvtc', 'seed', '--operator', '7', '--bind', '--status', 'rejected']);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});

describe('idvtc review', () => {
  it('updates the active form review', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.idvtcForm.findFirst.mockResolvedValue({ id: 2, review: { id: 8 } } as any);
    await run(prisma, ['idvtc', 'review', '--main-address', '0x' + '2'.repeat(40), '--status', 'approved']);
    expect(prisma.idvtcFormReview.update).toHaveBeenCalledWith({
      where: { id: 8 }, data: expect.objectContaining({ status: 'APPROVED' }),
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test idvtc`
Expected: FAIL — cannot resolve `../src/commands/idvtc`.

- [ ] **Step 3: Implement `src/commands/idvtc.ts`**

```ts
import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import { mapFields, resolveReviewerId } from './ics';
import { IdvtcFormStatus } from '../db';

export const IDVTC_COMMENTS: Record<string, string> = {
  reason: 'comment', mainAddress: 'mainAddressComment', discordLink: 'discordLinkComment',
  telegramUsername: 'telegramUsernameComment', member1: 'clusterMemberComment1', member2: 'clusterMemberComment2',
  member3: 'clusterMemberComment3', member4: 'clusterMemberComment4',
};

export const idvtcCommands: SeedCommand[] = [
  {
    group: 'idvtc',
    name: 'seed',
    summary: 'Create an IDVTC cluster form for an address in any status',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--main-address <a>', desc: 'main address (random if omitted)', coerce: toAddress },
      { flag: '--discord <s>', desc: 'discord link' },
      { flag: '--telegram <s>', desc: 'telegram username' },
      { flag: '--member <a...>', desc: 'cluster member address (up to 4)', repeatable: true, coerce: toAddress },
      { flag: '--bind', desc: 'bind to --operator (sets issued + boundToNodeOperatorId; implies approved)' },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
    ],
    run: async (prisma, args) => {
      const mainAddress = resolveAddress(args.mainAddress as string | undefined);
      const bind = Boolean(args.bind);
      // Real binding (initFromIdvtc) sets issued + boundToNodeOperatorId atomically, APPROVED forms only.
      const status =
        (args.status as string | undefined) ?? (bind ? IdvtcFormStatus.APPROVED : IdvtcFormStatus.REVIEW);
      if (bind && !args.operator) throw new Error('--bind requires --operator');
      if (bind && status !== IdvtcFormStatus.APPROVED) {
        throw new Error('--bind requires an APPROVED form (only approved forms are ever bound)');
      }
      const members = (args.member as string[] | undefined) ?? [];
      const formData: Record<string, unknown> = {
        mainAddress,
        discordLink: (args.discord as string) ?? 'https://discord.example',
        telegramUsername: (args.telegram as string) ?? null,
        boundToNodeOperatorId: bind ? String(args.operator) : null,
        ...(bind ? { issued: true } : {}),
      };
      for (let i = 1; i <= 4; i++) {
        formData[`clusterAddress${i}`] = resolveAddress(members[i - 1]);
        formData[`clusterSignature${i}`] = placeholderSignature();
      }
      const reviewData: Record<string, unknown> = {
        status,
        ...mapFields(args.comment as Record<string, string>, IDVTC_COMMENTS, (s) => s || null),
      };
      const created = await prisma.$transaction(async (tx) => {
        await tx.idvtcForm.updateMany({ where: { mainAddress }, data: { outdated: true } });
        return tx.idvtcForm.create({ data: { ...formData, review: { create: reviewData } } as never, include: { review: true } });
      });
      return { entity: 'idvtc', action: 'seed', operator: args.operator ?? null, mainAddress, status, form: created };
    },
  },
  {
    group: 'idvtc',
    name: 'review',
    summary: 'Update the active IDVTC form review',
    options: [
      { flag: '--main-address <a>', desc: 'main address of the form', coerce: toAddress },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      { flag: '--reviewer <a>', desc: 'reviewer admin address (create-if-missing)', coerce: toAddress },
    ],
    run: async (prisma, args) => {
      const mainAddress = args.mainAddress as string;
      if (!mainAddress) throw new Error('--main-address is required');
      const form = await prisma.idvtcForm.findFirst({ where: { mainAddress, outdated: false }, include: { review: true } });
      if (!form || !form.review) throw new Error(`No active IDVTC form for ${mainAddress}`);
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const data: Record<string, unknown> = {
        ...(args.status ? { status: args.status } : {}),
        ...(lastReviewerId !== undefined ? { lastReviewerId } : {}),
        ...mapFields(args.comment as Record<string, string>, IDVTC_COMMENTS, (s) => s || null),
      };
      const updated = await prisma.idvtcFormReview.update({ where: { id: form.review.id }, data: data as never });
      return { entity: 'idvtc', action: 'review', mainAddress, review: updated };
    },
  },
];
```

- [ ] **Step 4: Register**

Modify `tools/survey/src/commands/index.ts`:

```ts
import type { SeedCommand } from '../define';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';

export const ALL_COMMANDS: SeedCommand[] = [...icsCommands, ...idvtcCommands];
```

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test idvtc` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/commands/idvtc.ts tools/survey/src/commands/index.ts tools/survey/test/idvtc.test.ts
git commit --no-gpg-sign -m "feat(survey): idvtc seed + review commands"
```

---

## Task 5: Members commands (`members set`, `members clear`)

**Files:**
- Create: `tools/survey/src/commands/members.ts`
- Modify: `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/members.test.ts`

**Interfaces:**
- Consumes: `SeedCommand`, `toAddress`; `resolveAddress`.
- Produces: `membersCommands: SeedCommand[]`.

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/members.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { membersCommands } from '../src/commands/members';

function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, membersCommands).parseAsync(argv, { from: 'user' });
}

describe('members set', () => {
  it('upserts ActiveMembers with 4 lowercased addresses (random-filled)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.activeMembers.upsert.mockResolvedValue({ id: 1 } as any);
    await run(prisma, ['members', 'set', '--operator', '42', '--member', '0x' + 'A'.repeat(40)]);
    const arg = prisma.activeMembers.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ nodeOperatorId: '42' });
    expect(arg.create.member1Address).toBe('0x' + 'a'.repeat(40));
    expect(arg.create.member4Address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('members clear', () => {
  it('deletes the ActiveMembers row by operator', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.activeMembers.deleteMany.mockResolvedValue({ count: 1 } as any);
    await run(prisma, ['members', 'clear', '--operator', '42']);
    expect(prisma.activeMembers.deleteMany).toHaveBeenCalledWith({ where: { nodeOperatorId: '42' } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test members`
Expected: FAIL — cannot resolve `../src/commands/members`.

- [ ] **Step 3: Implement `src/commands/members.ts`**

```ts
import type { SeedCommand } from '../define';
import { toAddress } from '../define';
import { resolveAddress } from '../gen';

function requireOperator(args: Record<string, unknown>): string {
  const op = args.operator as string | undefined;
  if (!op) throw new Error('--operator is required');
  return op;
}

export const membersCommands: SeedCommand[] = [
  {
    group: 'members',
    name: 'set',
    summary: 'Set the ActiveMembers row for an operator (4 slots; missing filled randomly)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--member <a...>', desc: 'member address (up to 4)', repeatable: true, coerce: toAddress },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const members = (args.member as string[] | undefined) ?? [];
      const data: Record<string, unknown> = { nodeOperatorId };
      for (let i = 1; i <= 4; i++) {
        data[`member${i}Address`] = resolveAddress(members[i - 1]);
        data[`member${i}DiscordHandle`] = null;
        data[`member${i}TelegramUsername`] = null;
      }
      const row = await prisma.activeMembers.upsert({ where: { nodeOperatorId }, create: data as never, update: data as never });
      return { entity: 'members', action: 'set', operator: nodeOperatorId, members: row };
    },
  },
  {
    group: 'members',
    name: 'clear',
    summary: 'Delete the ActiveMembers row for an operator',
    options: [{ flag: '--operator <id>', desc: 'node operator id' }],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const { count } = await prisma.activeMembers.deleteMany({ where: { nodeOperatorId } });
      return { entity: 'members', action: 'clear', operator: nodeOperatorId, deleted: count };
    },
  },
];
```

- [ ] **Step 4: Register**

Modify `tools/survey/src/commands/index.ts` (add import + spread `...membersCommands`).

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test members` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/commands/members.ts tools/survey/src/commands/index.ts tools/survey/test/members.test.ts
git commit --no-gpg-sign -m "feat(survey): members set + clear commands"
```

---

## Task 6: Rotation commands (`rotation create`, `rotation review`)

**Files:**
- Create: `tools/survey/src/commands/rotation.ts`
- Modify: `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/rotation.test.ts`

**Interfaces:**
- Consumes: `SeedCommand`, `toAddress`, `toStatus`; `resolveAddress`, `placeholderSignature`;
  `resolveReviewerId` (from `./ics`); `RotationRequestStatus` from `../db`.
- Produces: `rotationCommands: SeedCommand[]`; `buildSlotColumns(addresses: string[]): Record<string, string | null>`;
  `mergeSlots(active, request)` — faithful port of survey-api `src/http/members/lib/merge-slots.ts`.

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { rotationCommands, buildSlotColumns, mergeSlots } from '../src/commands/rotation';

const A1 = '0x' + '1'.repeat(40);
const B = (n: number) => '0x' + String(n).repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, rotationCommands).parseAsync(argv, { from: 'user' });
}
const openRequest = (slots: Record<string, string | null> = {}) => ({
  id: 5,
  slot1NewAddress: null, slot1DiscordHandle: null, slot1TelegramUsername: null,
  slot2NewAddress: null, slot2DiscordHandle: null, slot2TelegramUsername: null,
  slot3NewAddress: null, slot3DiscordHandle: null, slot3TelegramUsername: null,
  slot4NewAddress: null, slot4DiscordHandle: null, slot4TelegramUsername: null,
  ...slots,
});
const activeRow = () => ({
  member1Address: B(6), member1DiscordHandle: 'd1', member1TelegramUsername: null,
  member2Address: B(7), member2DiscordHandle: null, member2TelegramUsername: 't2',
  member3Address: B(8), member3DiscordHandle: null, member3TelegramUsername: null,
  member4Address: B(9), member4DiscordHandle: null, member4TelegramUsername: null,
});

describe('buildSlotColumns', () => {
  it('pairs address with placeholder sig, nulls empty slots', () => {
    const c = buildSlotColumns([A1]);
    expect(c.slot1NewAddress).toBe(A1);
    expect(c.slot1Signature).toBe('0x' + '00'.repeat(65));
    expect(c.slot2NewAddress).toBeNull();
    expect(c.slot2Signature).toBeNull();
  });
});

describe('mergeSlots', () => {
  it('patched slots win, null slots carry over from active', () => {
    const m = mergeSlots(activeRow(), openRequest({ slot1NewAddress: A1 }));
    expect(m.member1Address).toBe(A1);
    expect(m.member1DiscordHandle).toBeNull();
    expect(m.member2Address).toBe(B(7));
    expect(m.member2TelegramUsername).toBe('t2');
  });
  it('requires all 4 slots on first init', () => {
    expect(() => mergeSlots(null, openRequest({ slot1NewAddress: A1 }))).toThrow('first-time init');
  });
  it('rejects duplicate merged addresses', () => {
    expect(() => mergeSlots(activeRow(), openRequest({ slot1NewAddress: B(7) }))).toThrow('duplicate');
  });
});

describe('rotation create', () => {
  it('supersedes prior open requests then creates a REVIEW request', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    prisma.activeMembers.findUnique.mockResolvedValue(activeRow() as any);
    tx.rotationRequest.create.mockResolvedValue({ id: 11 } as any);
    await run(prisma, ['rotation', 'create', '--operator', '42', '--slot', A1]);
    expect(tx.rotationRequest.updateMany).toHaveBeenCalledWith({
      where: { nodeOperatorId: '42', superseded: false, status: { not: 'APPROVED' } }, data: { superseded: true },
    });
    const data = tx.rotationRequest.create.mock.calls[0][0].data;
    expect(data.nodeOperatorId).toBe('42');
    expect(data.slot1NewAddress).toBe(A1);
    expect(data.slot1Signature).toBe('0x' + '00'.repeat(65));
    expect(data.slot2NewAddress).toBeNull(); // members exist → no padding
  });

  it('pads to 4 slots when the operator has no ActiveMembers row (first-init rule)', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    prisma.activeMembers.findUnique.mockResolvedValue(null as any);
    tx.rotationRequest.create.mockResolvedValue({ id: 12 } as any);
    await run(prisma, ['rotation', 'create', '--operator', '42', '--slot', A1]);
    const data = tx.rotationRequest.create.mock.calls[0][0].data;
    expect(data.slot1NewAddress).toBe(A1);
    for (const i of [2, 3, 4]) expect(data[`slot${i}NewAddress`]).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('rotation review', () => {
  it('approve merges slots into ActiveMembers, then updates the request', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.rotationRequest.findFirst.mockResolvedValue(openRequest({ slot1NewAddress: A1 }) as any);
    tx.activeMembers.findUnique.mockResolvedValue(activeRow() as any);
    tx.rotationRequest.update.mockResolvedValue({ id: 5 } as any);
    await run(prisma, ['rotation', 'review', '--operator', '42', '--status', 'approved', '--comment', 'slot1=ok']);
    expect(tx.rotationRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nodeOperatorId: '42', superseded: false, status: 'REVIEW' } }),
    );
    const up = tx.activeMembers.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ nodeOperatorId: '42' });
    expect(up.update.member1Address).toBe(A1); // patched slot wins
    expect(up.update.member2Address).toBe(B(7)); // null slot carried over
    const arg = tx.rotationRequest.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 5 });
    expect(arg.data.status).toBe('APPROVED');
    expect(arg.data.slot1Comment).toBe('ok');
    expect(arg.data.reviewedAt).toBeInstanceOf(Date);
  });

  it('reject leaves ActiveMembers untouched', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.rotationRequest.findFirst.mockResolvedValue(openRequest({ slot1NewAddress: A1 }) as any);
    tx.rotationRequest.update.mockResolvedValue({ id: 5 } as any);
    await run(prisma, ['rotation', 'review', '--operator', '42', '--status', 'rejected']);
    expect(tx.activeMembers.upsert).not.toHaveBeenCalled();
    expect(tx.rotationRequest.update.mock.calls[0][0].data.status).toBe('REJECTED');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test rotation`
Expected: FAIL — cannot resolve `../src/commands/rotation`.

- [ ] **Step 3: Implement `src/commands/rotation.ts`**

```ts
import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import { resolveReviewerId } from './ics';
import { RotationRequestStatus } from '../db';

const ROTATION_COMMENTS: Record<string, string> = {
  reason: 'comment', slot1: 'slot1Comment', slot2: 'slot2Comment', slot3: 'slot3Comment', slot4: 'slot4Comment',
};

/** Up to 4 slot addresses → paired NewAddress/Signature columns; empty slots null (honors the CHECK). */
export function buildSlotColumns(addresses: string[]): Record<string, string | null> {
  const cols: Record<string, string | null> = {};
  for (let i = 1; i <= 4; i++) {
    const addr = addresses[i - 1] ?? null;
    cols[`slot${i}NewAddress`] = addr;
    cols[`slot${i}Signature`] = addr ? placeholderSignature() : null;
  }
  return cols;
}

type MemberFields = Record<string, string | null>;

/** Faithful port of survey-api `src/http/members/lib/merge-slots.ts`: patched slots win, null slots
 * carry over from the current ActiveMembers; all 4 required on first init; duplicates rejected. */
export function mergeSlots(active: MemberFields | null, request: MemberFields): MemberFields {
  const merged: MemberFields = {};
  for (const i of [1, 2, 3, 4]) {
    const newAddr = request[`slot${i}NewAddress`];
    if (newAddr != null) {
      merged[`member${i}Address`] = newAddr;
      merged[`member${i}DiscordHandle`] = request[`slot${i}DiscordHandle`] ?? null;
      merged[`member${i}TelegramUsername`] = request[`slot${i}TelegramUsername`] ?? null;
    } else {
      if (!active) throw new Error(`all 4 slots required for first-time init; slot ${i} missing`);
      merged[`member${i}Address`] = active[`member${i}Address`] ?? null;
      merged[`member${i}DiscordHandle`] = active[`member${i}DiscordHandle`] ?? null;
      merged[`member${i}TelegramUsername`] = active[`member${i}TelegramUsername`] ?? null;
    }
  }
  const addrs = [1, 2, 3, 4].map((i) => merged[`member${i}Address`]);
  if (new Set(addrs).size !== 4) throw new Error('duplicate addresses in merged members');
  return merged;
}

function requireOperator(args: Record<string, unknown>): string {
  const op = args.operator as string | undefined;
  if (!op) throw new Error('--operator is required');
  return op;
}

export const rotationCommands: SeedCommand[] = [
  {
    group: 'rotation',
    name: 'create',
    summary: 'Create a rotation request (supersedes prior open request; pads to 4 slots on first init)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--slot <a...>', desc: 'new slot address (up to 4; 1 random if none)', repeatable: true, coerce: toAddress },
      { flag: '--submitter <a>', desc: 'submitter address (random if omitted)', coerce: toAddress },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const submitterAddress = resolveAddress(args.submitter as string | undefined);
      const slots = (args.slot as string[] | undefined) ?? [];
      if (slots.length === 0) slots.push(resolveAddress());
      // First-time init: with no ActiveMembers row the real system requires all 4 slots — pad randomly,
      // otherwise the request could never be approved (mergeSlots throws on first init with <4 slots).
      const active = await prisma.activeMembers.findUnique({ where: { nodeOperatorId } });
      if (!active) while (slots.length < 4) slots.push(resolveAddress());
      const cols = buildSlotColumns(slots);
      const created = await prisma.$transaction(async (tx) => {
        await tx.rotationRequest.updateMany({
          where: { nodeOperatorId, superseded: false, status: { not: RotationRequestStatus.APPROVED } },
          data: { superseded: true },
        });
        return tx.rotationRequest.create({ data: { nodeOperatorId, submitterAddress, ...cols } as never });
      });
      return { entity: 'rotation', action: 'create', operator: nodeOperatorId, submitterAddress, request: created };
    },
  },
  {
    group: 'rotation',
    name: 'review',
    summary: 'Review the open rotation request (approve applies merged slots to ActiveMembers)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--comment <kv...>', desc: 'field=text comment (reason|slot1..slot4)', repeatable: true, kv: true },
      { flag: '--reviewer <a>', desc: 'reviewer admin address (create-if-missing)', coerce: toAddress },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const status = args.status as string | undefined;
      if (!status) throw new Error('--status is required');
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const comments: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((args.comment as Record<string, string>) ?? {})) {
        const col = ROTATION_COMMENTS[k];
        if (!col) throw new Error(`Unknown comment field '${k}' (expected: ${Object.keys(ROTATION_COMMENTS).join(', ')})`);
        comments[col] = v || null;
      }
      const updated = await prisma.$transaction(async (tx) => {
        const open = await tx.rotationRequest.findFirst({
          where: { nodeOperatorId, superseded: false, status: RotationRequestStatus.REVIEW },
          orderBy: { createdAt: 'desc' },
        });
        if (!open) throw new Error(`No open rotation request for operator ${nodeOperatorId}`);
        if (status === RotationRequestStatus.APPROVED) {
          // Mirror the real admin patch: approval lands the merged slots in ActiveMembers.
          const active = await tx.activeMembers.findUnique({ where: { nodeOperatorId } });
          const merged = mergeSlots(active as MemberFields | null, open as unknown as MemberFields);
          await tx.activeMembers.upsert({
            where: { nodeOperatorId },
            create: { nodeOperatorId, ...merged } as never,
            update: merged as never,
          });
        }
        return tx.rotationRequest.update({
          where: { id: open.id },
          data: { status, reviewedAt: new Date(), ...(lastReviewerId !== undefined ? { lastReviewerId } : {}), ...comments } as never,
        });
      });
      return { entity: 'rotation', action: 'review', operator: nodeOperatorId, request: updated };
    },
  },
];
```

- [ ] **Step 4: Register**

Modify `tools/survey/src/commands/index.ts` (add import + spread `...rotationCommands`).

- [ ] **Step 5: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test rotation` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/commands/rotation.ts tools/survey/src/commands/index.ts tools/survey/test/rotation.test.ts
git commit --no-gpg-sign -m "feat(survey): rotation create + review commands"
```

---

## Task 7: Files clear + operator reset

**Files:**
- Create: `tools/survey/src/commands/files.ts`, `tools/survey/src/commands/maintenance.ts`
- Modify: `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/files.test.ts`, `tools/survey/test/maintenance.test.ts`

**Interfaces:**
- Consumes: `SeedCommand`, `toAddress`; `assertAddress`; `PrismaClient` from `../db`.
- Produces: `filesCommands: SeedCommand[]`; `resetCommand: SeedCommand`; `wipeOperator(tx, id)`.

- [ ] **Step 1: Write the failing tests**

Create `tools/survey/test/files.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { filesCommands } from '../src/commands/files';

describe('files clear', () => {
  it('deletes all OperatorFile rows for an operator', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.operatorFile.deleteMany.mockResolvedValue({ count: 3 } as any);
    await buildProgram(prisma, filesCommands).parseAsync(['files', 'clear', '--operator', '42'], { from: 'user' });
    expect(prisma.operatorFile.deleteMany).toHaveBeenCalledWith({ where: { nodeOperatorId: '42' } });
  });
});
```

Create `tools/survey/test/maintenance.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { resetCommand } from '../src/commands/maintenance';

const MODELS = ['activeMembers','rotationRequest','operatorFile','setup','setupSnapshot','contacts','experience','howDidYouLearnCsm','delegate','idvtcForm','icsForm'] as const;

describe('reset', () => {
  it('clears operator-keyed tables + bound idvtc; reports skipped forms without --main-address', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    for (const m of MODELS) (tx as any)[m].deleteMany.mockResolvedValue({ count: 0 });
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s?: unknown) => void out.push(String(s)));
    await buildProgram(prisma, [resetCommand]).parseAsync(['reset', '--operator', '42', '--json'], { from: 'user' });
    vi.restoreAllMocks();
    expect(tx.activeMembers.deleteMany).toHaveBeenCalledWith({ where: { nodeOperatorId: '42' } });
    expect(tx.idvtcForm.deleteMany).toHaveBeenCalledWith({ where: { boundToNodeOperatorId: '42' } });
    expect(tx.icsForm.deleteMany).not.toHaveBeenCalled();
    expect(JSON.parse(out[0]).note).toContain('--main-address');
  });

  it('also clears forms by main address when given', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    for (const m of MODELS) (tx as any)[m].deleteMany.mockResolvedValue({ count: 0 });
    await buildProgram(prisma, [resetCommand]).parseAsync(['reset', '--operator', '42', '--main-address', '0x' + '1'.repeat(40)], { from: 'user' });
    expect(tx.icsForm.deleteMany).toHaveBeenCalledWith({ where: { mainAddress: '0x' + '1'.repeat(40) } });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @sm-lab/survey test files maintenance`
Expected: FAIL — cannot resolve `./files` / `./maintenance`.

- [ ] **Step 3: Implement `src/commands/files.ts`**

```ts
import type { SeedCommand } from '../define';

export const filesCommands: SeedCommand[] = [
  {
    group: 'files',
    name: 'clear',
    summary: 'Delete all OperatorFile rows for an operator',
    options: [{ flag: '--operator <id>', desc: 'node operator id' }],
    run: async (prisma, args) => {
      const nodeOperatorId = args.operator as string | undefined;
      if (!nodeOperatorId) throw new Error('--operator is required');
      const { count } = await prisma.operatorFile.deleteMany({ where: { nodeOperatorId } });
      return { entity: 'files', action: 'clear', operator: nodeOperatorId, deleted: count };
    },
  },
];
```

- [ ] **Step 4: Implement `src/commands/maintenance.ts` (reset; scenario added in Task 8)**

```ts
import type { PrismaClient } from '../db';
import type { SeedCommand } from '../define';
import { toAddress } from '../define';
import { assertAddress } from '../gen';

/** Delete every operator-keyed row for an operator, plus IDVTC forms bound to it. */
export async function wipeOperator(tx: PrismaClient, nodeOperatorId: string): Promise<Record<string, number>> {
  const c: Record<string, number> = {};
  c.activeMembers = (await tx.activeMembers.deleteMany({ where: { nodeOperatorId } })).count;
  c.rotationRequests = (await tx.rotationRequest.deleteMany({ where: { nodeOperatorId } })).count;
  c.operatorFiles = (await tx.operatorFile.deleteMany({ where: { nodeOperatorId } })).count;
  c.setup = (await tx.setup.deleteMany({ where: { nodeOperatorId } })).count;
  c.setupSnapshots = (await tx.setupSnapshot.deleteMany({ where: { nodeOperatorId } })).count;
  c.contacts = (await tx.contacts.deleteMany({ where: { nodeOperatorId } })).count;
  c.experience = (await tx.experience.deleteMany({ where: { nodeOperatorId } })).count;
  c.howDidYouLearnCsm = (await tx.howDidYouLearnCsm.deleteMany({ where: { nodeOperatorId } })).count;
  c.delegates = (await tx.delegate.deleteMany({ where: { nodeOperatorId } })).count;
  c.idvtcFormsBound = (await tx.idvtcForm.deleteMany({ where: { boundToNodeOperatorId: nodeOperatorId } })).count;
  return c;
}

export const resetCommand: SeedCommand = {
  group: 'root',
  name: 'reset',
  summary: 'Wipe an operator across tables (address-keyed forms only with --main-address)',
  options: [
    { flag: '--operator <id>', desc: 'node operator id' },
    { flag: '--main-address <a>', desc: 'also delete ICS/IDVTC forms for this address', coerce: toAddress },
  ],
  run: async (prisma, args) => {
    const nodeOperatorId = args.operator as string | undefined;
    if (!nodeOperatorId) throw new Error('--operator is required');
    const mainAddress = args.mainAddress as string | undefined;
    const deleted = await prisma.$transaction(async (tx) => {
      const counts = await wipeOperator(tx as unknown as PrismaClient, nodeOperatorId);
      if (mainAddress) {
        const addr = assertAddress(mainAddress);
        counts.icsFormsByAddress = (await tx.icsForm.deleteMany({ where: { mainAddress: addr } })).count;
        counts.idvtcFormsByAddress = (await tx.idvtcForm.deleteMany({ where: { mainAddress: addr } })).count;
      }
      return counts;
    });
    return {
      entity: 'reset',
      operator: nodeOperatorId,
      deleted,
      ...(mainAddress ? {} : { note: 'ICS/IDVTC forms are address-keyed — pass --main-address to clear them' }),
    };
  },
};
```

- [ ] **Step 5: Register**

Modify `tools/survey/src/commands/index.ts` (add `...filesCommands, resetCommand`).

- [ ] **Step 6: Run to verify green**

Run: `pnpm --filter @sm-lab/survey test files maintenance` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tools/survey/src/commands/files.ts tools/survey/src/commands/maintenance.ts tools/survey/src/commands/index.ts tools/survey/test/files.test.ts tools/survey/test/maintenance.test.ts
git commit --no-gpg-sign -m "feat(survey): files clear + operator reset"
```

---

## Task 8: Composite scenarios (`scenario <name>`)

**Files:**
- Modify: `tools/survey/src/commands/maintenance.ts`, `tools/survey/src/commands/index.ts`
- Test: `tools/survey/test/scenario.test.ts`

**Interfaces:**
- Consumes: the `run` functions of `icsCommands`/`idvtcCommands`/`membersCommands`/`rotationCommands`.
- Produces: `scenarioCommand: SeedCommand`; `SCENARIOS: Record<string, (prisma, operator) => Promise<unknown>>`.

- [ ] **Step 1: Write the failing test**

Create `tools/survey/test/scenario.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { scenarioCommand, SCENARIOS } from '../src/commands/maintenance';

function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, [scenarioCommand]).parseAsync(argv, { from: 'user' });
}

describe('scenario', () => {
  it('exposes the three starter scenarios', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(['approved-ics', 'idvtc-with-members', 'pending-rotation']);
  });

  it('idvtc-with-members seeds a bound approved form + matching active members', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 1 } as any);
    prisma.activeMembers.upsert.mockResolvedValue({ id: 1 } as any);
    await run(prisma, ['scenario', 'idvtc-with-members', '--operator', '9']);
    const form = tx.idvtcForm.create.mock.calls[0][0].data;
    expect(form.boundToNodeOperatorId).toBe('9');
    expect(form.issued).toBe(true);
    const up = prisma.activeMembers.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ nodeOperatorId: '9' });
    // Mirrors initFromIdvtc: ActiveMembers holds the SAME addresses as the bound form's cluster.
    for (const i of [1, 2, 3, 4]) expect(up.create[`member${i}Address`]).toBe(form[`clusterAddress${i}`]);
  });

  it('rejects an unknown scenario name', async () => {
    const prisma = mockDeep<PrismaClient>();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['scenario', 'nope', '--operator', '9']);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @sm-lab/survey test scenario`
Expected: FAIL — `scenarioCommand`/`SCENARIOS` not exported.

- [ ] **Step 3: Add scenarios + `scenarioCommand` to `src/commands/maintenance.ts`**

Append (the `argument` field is already supported by `defineCommand` from Task 2):

```ts
import { resolveAddress } from '../gen';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';
import { membersCommands } from './members';
import { rotationCommands } from './rotation';

function runner(commands: SeedCommand[], name: string) {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`missing command ${name}`);
  return c.run;
}

const icsSeed = runner(icsCommands, 'seed');
const idvtcSeed = runner(idvtcCommands, 'seed');
const membersSet = runner(membersCommands, 'set');
const rotationCreate = runner(rotationCommands, 'create');

export const SCENARIOS: Record<string, (prisma: PrismaClient, operator: string) => Promise<unknown>> = {
  'approved-ics': async (prisma, operator) => ({ ics: await icsSeed(prisma, { operator, status: 'APPROVED' }) }),

  'idvtc-with-members': async (prisma, operator) => {
    // Mirror initFromIdvtc: ActiveMembers must hold the SAME addresses as the bound form's cluster.
    const member = Array.from({ length: 4 }, () => resolveAddress());
    const idvtc = await idvtcSeed(prisma, { operator, status: 'APPROVED', bind: true, member });
    const members = await membersSet(prisma, { operator, member });
    return { idvtc, members };
  },

  'pending-rotation': async (prisma, operator) => {
    const members = await membersSet(prisma, { operator });
    const rotation = await rotationCreate(prisma, { operator });
    return { members, rotation };
  },
};

export const scenarioCommand: SeedCommand = {
  group: 'root',
  name: 'scenario',
  summary: `Compose a full operator scenario (${Object.keys(SCENARIOS).join(', ')})`,
  argument: { name: 'name', desc: 'scenario name', prop: 'name' },
  options: [{ flag: '--operator <id>', desc: 'node operator id' }],
  run: async (prisma, args) => {
    const name = args.name as string | undefined;
    const operator = args.operator as string | undefined;
    if (!operator) throw new Error('--operator is required');
    if (!name || !SCENARIOS[name]) {
      throw new Error(`Unknown scenario '${name ?? ''}' (expected: ${Object.keys(SCENARIOS).join(', ')})`);
    }
    return { entity: 'scenario', name, operator, result: await SCENARIOS[name](prisma, operator) };
  },
};
```

- [ ] **Step 4: Register**

Modify `tools/survey/src/commands/index.ts` — import `scenarioCommand` and append it to `ALL_COMMANDS`:

```ts
export const ALL_COMMANDS: SeedCommand[] = [
  ...icsCommands, ...idvtcCommands, ...membersCommands, ...rotationCommands,
  ...filesCommands, resetCommand, scenarioCommand,
];
```

- [ ] **Step 5: Run all suites to verify green**

Run: `pnpm --filter @sm-lab/survey test` → Expected: PASS (all suites, incl. `define` unchanged).
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/survey/src/commands/maintenance.ts tools/survey/src/commands/index.ts tools/survey/test/scenario.test.ts
git commit --no-gpg-sign -m "feat(survey): composite scenario command"
```

---

## Task 9: README + CLAUDE.md + final gates

**Files:**
- Create: `tools/survey/README.md`
- Modify: root `CLAUDE.md`

- [ ] **Step 1: Write `tools/survey/README.md`**

```markdown
# @sm-lab/survey

Direct-DB seed CLI for the Lido CSM survey-api — puts a **local** survey-api Postgres into arbitrary
states for widget/SDK testing. Private, unpublished, dev-only. Bypasses SIWE/signature validation on
purpose (signatures are placeholders).

## Run

Set `DATABASE_URL` (the local survey-api Postgres) in `.env`, then:

```
pnpm --filter @sm-lab/survey exec tsx src/cli.ts <group> <cmd> [--json]
```

Groups: `ics seed|review`, `idvtc seed|review`, `members set|clear`, `rotation create|review`,
`files clear`, plus `reset` and `scenario <name>` (`approved-ics` | `idvtc-with-members` | `pending-rotation`).
Random addresses are generated for anything not passed and echoed in the output. `reset` wipes an
operator; pass `--main-address` to also clear address-keyed ICS/IDVTC forms.

## State invariants replicated

Seeded state matches what the real write paths produce: form creation flips prior rows to `outdated`;
`idvtc seed --bind` sets `issued` **and** `boundToNodeOperatorId` (APPROVED-only, like `initFromIdvtc`);
`rotation create` supersedes the prior open request and pads to 4 slots when the operator has no
`ActiveMembers` row (first-init rule); `rotation review --status approved` merges the request's slots
into `ActiveMembers` in the same transaction (port of survey-api's `mergeSlots`); `ics review --issued`
marks the proof issued (approved forms only — it locks the review in the real admin UI). Seeded reviews
carry a null `lastReviewerId` unless `--reviewer` is given (nullable column; the admin UI tolerates it).

No `setup` seeding: survey-api's own Prisma client auto-assigns `Setup.index` and writes
`SetupSnapshot`s via client extensions the vendored client lacks.

## Syncing the vendored schema with survey-api

The Prisma client is generated from a vendored, **generate-only** copy of survey-api's `schema.prisma`
(sm-lab never migrates). When survey-api's schema changes, re-vendor + regenerate:

```
pnpm --filter @sm-lab/survey refresh --source /path/to/survey-api
# or: SURVEY_API_PATH=/path/to/survey-api pnpm --filter @sm-lab/survey refresh
```

This copies the model/enum blocks, prepends sm-lab's generator/datasource header, runs
`prisma generate`, and records provenance (survey-api ref + commit) in `prisma/manifest.json`. It
refuses a dirty source tree unless `--force`. Check `prisma/manifest.json` to see which survey-api
commit the client currently matches.
```

- [ ] **Step 2: Add a status bullet to root `CLAUDE.md`**

Under the Status section add:

```markdown
- **`@sm-lab/survey`** ✅ — private, dev-only seed CLI for the survey-api Postgres (widget/SDK
  testing). Direct Prisma writes via a **vendored, generate-only** copy of survey-api's `schema.prisma`
  (never migrates); `src/refresh.ts` re-vendors + regenerates + records provenance in
  `prisma/manifest.json`. Commands mirror `recipes`' declarative registry (`defineCommand`/`buildProgram`,
  `--json`): `ics`/`idvtc` seed+review (`--bind` = `issued`+`boundToNodeOperatorId`, APPROVED-only;
  `ics review --issued`), `members` set/clear, `rotation` create/review (approve merges slots into
  `ActiveMembers` via a `mergeSlots` port; create pads to 4 slots on first init), `files clear`,
  `reset`, `scenario`. Runs via `tsx` (Prisma runtime doesn't bundle). Hermetic vitest tests inject
  `mockDeep<PrismaClient>()`. See `docs/superpowers/specs/2026-07-21-survey-seed-cli-design.md`.
```

- [ ] **Step 3: Run the full gate suite**

Run: `pnpm --filter @sm-lab/survey generate` → regenerate client (idempotent).
Run: `pnpm --filter @sm-lab/survey test` → Expected: PASS.
Run: `pnpm --filter @sm-lab/survey types` → Expected: no errors.
Run: `pnpm --filter @sm-lab/survey build` → Expected: tsdown builds `dist/cli.mjs` (prisma/pg external).
Run: `pnpm exec oxlint tools/survey/src` → Expected: no errors (fix unused imports, etc.).
Run: `pnpm exec prettier --check "tools/survey/**/*.{ts,json}"` → format if needed.

- [ ] **Step 4: Manual smoke against a local DB (optional but recommended)**

With a local survey-api Postgres migrated and `DATABASE_URL` set:

```
pnpm --filter @sm-lab/survey exec tsx src/cli.ts scenario idvtc-with-members --operator 999 --json
pnpm --filter @sm-lab/survey exec tsx src/cli.ts reset --operator 999 --main-address 0x... --json
```

- [ ] **Step 5: Commit**

```bash
git add tools/survey/README.md CLAUDE.md
git commit --no-gpg-sign -m "docs(survey): README + CLAUDE.md status for @sm-lab/survey"
```

---

## Notes for the implementer

- **`--no-gpg-sign` on every commit.** The maintainer signs the final push separately.
- **`as never` casts on Prisma `data`** are deliberate — the CLI builds `data` objects with dynamic
  index signatures that Prisma's strict generated input types reject at compile time even when the
  runtime shape is correct. Do not widen the client's types.
- **Enum values are PSL names** (`'APPROVED'`), not DB values — Prisma maps them.
- **Never `prisma migrate` from sm-lab.** The DB is survey-api's; sm-lab only `prisma generate`.
- **Do not** reintroduce signature validation, SIWE, or the resubmit-only-when-REJECTED guard —
  bypassing them is the whole point of a local seed tool.
- **`mergeSlots` is a faithful port** of survey-api `src/http/members/lib/merge-slots.ts` — keep the
  semantics identical (patched slots win, null slots carry over, all-4 first-init rule, duplicate
  rejection). If survey-api changes it, re-port alongside the schema refresh.
- **Prisma/pg version:** pin the catalog to the exact major.minor survey-api uses (Step 0 Step 1),
  or the generated client may mismatch the DB driver expectations.
```
