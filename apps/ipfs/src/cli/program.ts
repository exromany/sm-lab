import { Command } from 'commander';
import { createCompletionCommand, readPackageVersion } from '@sm-lab/core';
import { serveCommand } from './serve';
import { statusCommand } from './status';
import { stopCommand } from './stop';
import { helpCommand } from './help';

/** Builds the full `sm-ipfs` program without parsing — the bin bootstrap and tests share it. */
export function buildProgram(): Command {
  const program = new Command()
    .name('sm-ipfs')
    .description('Pinata-compatible IPFS pinning + gateway mock for Lido SM testing')
    .version(readPackageVersion(import.meta.url))
    .option('--url <url>', 'IPFS mock server URL (for status/stop commands)')
    .helpCommand(false);

  program.addCommand(serveCommand);
  program.addCommand(statusCommand);
  program.addCommand(stopCommand);
  program.addCommand(helpCommand);
  program.addCommand(createCompletionCommand());

  return program;
}
