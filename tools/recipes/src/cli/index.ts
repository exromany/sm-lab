#!/usr/bin/env node

// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { buildProgram } from './program';

buildProgram().parse();
