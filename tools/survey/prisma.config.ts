// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 dropped `datasource.url` from schema files — the URL now lives here.
// Read directly from process.env (not Prisma's eager `env()` helper) so that
// `prisma generate` works without a DATABASE_URL; only actual DB access needs it set.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
