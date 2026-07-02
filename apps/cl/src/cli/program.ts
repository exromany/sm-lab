import { Command } from 'commander';
import { createCompletionCommand, readPackageVersion } from '@sm-lab/core';
import { serveCommand } from './serve';
import { configCommand } from './config';
import { queryCommand } from './query';
import { statusCommand } from './status';
import { stopCommand } from './stop';
import { helpCommand } from './help';

/** Builds the full `sm-cl` program without parsing — the bin bootstrap and tests share it. */
export function buildProgram(): Command {
  const program = new Command()
    .name('sm-cl')
    .description('Consensus Layer mock server for Lido SM testing')
    .version(readPackageVersion(import.meta.url))
    .option('--url <url>', 'CL mock server URL (for config/query/status/stop commands)')
    .helpCommand(false);

  program.addCommand(serveCommand);
  program.addCommand(configCommand);
  program.addCommand(queryCommand);
  program.addCommand(statusCommand);
  program.addCommand(stopCommand);
  program.addCommand(helpCommand);
  program.addCommand(createCompletionCommand());

  return program;
}
