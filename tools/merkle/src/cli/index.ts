#!/usr/bin/env node

// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { buildProgram } from './program';

buildProgram()
  .parseAsync()
  .catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
