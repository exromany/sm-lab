// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { ALL_COMMANDS } from './commands';
import type { PrismaClient } from './db';
import { buildProgram } from './define';
import { createPrisma } from './prisma';

async function main(): Promise<void> {
  let prisma: PrismaClient | undefined;
  const getPrisma = (): PrismaClient => {
    if (!prisma) {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set');
      prisma = createPrisma(url);
    }
    return prisma;
  };
  try {
    await buildProgram(getPrisma, ALL_COMMANDS).parseAsync(process.argv);
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
