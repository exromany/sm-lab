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
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}
