#!/usr/bin/env node

import { Command } from 'commander';
import { serveCommand } from './serve';
import { statusCommand } from './status';
import { stopCommand } from './stop';
import { helpCommand } from './help';

const program = new Command()
  .name('csm-ipfs-mock')
  .description('Pinata-compatible IPFS pinning + gateway mock for CSM testing')
  .option('--url <url>', 'IPFS mock server URL (for status/stop commands)')
  .addHelpCommand(false);

program.addCommand(serveCommand);
program.addCommand(statusCommand);
program.addCommand(stopCommand);
program.addCommand(helpCommand);

program.parse();
