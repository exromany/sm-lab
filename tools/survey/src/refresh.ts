// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vendored generator/datasource header prepended to survey-api's model/enum bodies.
// No `url` in the datasource block — Prisma 7 dropped schema-file datasource URLs;
// it is supplied by prisma.config.ts's `datasource.url` instead (see that file).
const HEADER = `generator client {
  provider            = "prisma-client"
  output              = "./../src/generated/prisma"
  runtime             = "nodejs"
  moduleFormat        = "esm"
  importFileExtension = ""
}

datasource db {
  provider     = "postgresql"
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
  const ref = execFileSync('git', ['-C', source, 'rev-parse', '--abbrev-ref', 'HEAD'])
    .toString()
    .trim();

  const srcSchema = readFileSync(resolve(source, 'prisma/schema.prisma'), 'utf8');
  // Drop everything up to and including the source datasource block; keep models/enums.
  const bodyStart = srcSchema.search(/^(model|enum)\s/m);
  if (bodyStart < 0) throw new Error('No model/enum blocks found in source schema');
  const body = srcSchema.slice(bodyStart);
  writeFileSync(resolve('prisma/schema.prisma'), HEADER + '\n' + body);

  execFileSync('pnpm', ['prisma', 'generate'], { stdio: 'inherit' });

  writeFileSync(
    resolve('prisma/manifest.json'),
    JSON.stringify(
      { sourceRef: ref, sourceCommit: commit, refreshedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  console.log(`Refreshed schema from ${source} @ ${ref} (${commit.slice(0, 8)})`);
}

main();
