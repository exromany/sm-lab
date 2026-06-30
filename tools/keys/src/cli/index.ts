#!/usr/bin/env node

import { buildProgram } from './program';

buildProgram()
  .parseAsync()
  .catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
