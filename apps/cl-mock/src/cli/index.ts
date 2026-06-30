#!/usr/bin/env node

import { Command } from 'commander';
import { serveCommand } from './serve';
import { configCommand } from './config';
import { queryCommand } from './query';
import { statusCommand } from './status';
import { stopCommand } from './stop';
import { helpCommand } from './help';

const program = new Command()
  .name('csm-cl-mock')
  .description('Consensus Layer mock server for CSM testing')
  .option('--url <url>', 'CL mock server URL (for config/stop commands)')
  .helpCommand(false);

program.addCommand(serveCommand);
program.addCommand(configCommand);
program.addCommand(queryCommand);
program.addCommand(statusCommand);
program.addCommand(stopCommand);
program.addCommand(helpCommand);

program.parse();
