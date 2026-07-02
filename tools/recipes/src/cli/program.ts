import { Command } from 'commander';
import { createCompletionCommand, readPackageVersion } from '@sm-lab/core';
import { connect } from '../context';
import { defineCommand, type RecipeCommand } from './define';
import { sharedCommands } from './commands/shared';
import { cmCommands } from './commands/cm';
import { csmCommands } from './commands/csm';

/** Pre-bind shared descriptors to a module so they run group-form without --module. */
const withModule = (descs: RecipeCommand[], module: 'cm' | 'csm'): RecipeCommand[] =>
  descs.map((d) => ({ ...d, module }));

// addCommand does NOT copy configureHelp settings (only the .command() factory does), so
// apply showGlobalOptions to every node — leaf --help must list --json/--module/--rpc-url.
const showGlobals = (c: Command): void => {
  c.configureHelp({ showGlobalOptions: true });
  for (const child of c.commands) showGlobals(child);
};

export function buildProgram(connectImpl: typeof connect = connect): Command {
  const program = new Command()
    .name('sm-recipes')
    .description('Prepare Lido SM on-chain state on an anvil fork (run-and-exit recipes)')
    .version(readPackageVersion(import.meta.url))
    .option('--rpc-url <url>', 'anvil fork RPC URL (default: $RPC_URL or http://127.0.0.1:8545)')
    .option('--module <csm|cm>', 'target module for shared commands')
    .option('--cl-mock-url <url>', 'cl-mock URL for cl-activate (default: $CL_MOCK_URL)')
    .option('--json', 'emit the raw result as JSON')
    .addHelpText(
      'after',
      `
Examples:
  sm-recipes operator-info 0 --module csm --json
  sm-recipes csm operator-info 0 --json
  sm-recipes add-keys 0 --module cm --json
  sm-recipes cm seed --json
  sm-recipes completion fish | source`,
    )
    // `sm-recipes help [cmd]` mirrors `--help` (and the cm/csm groups get it too).
    .helpCommand(true);

  for (const desc of sharedCommands) program.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(createCompletionCommand());

  // Each group lists its own recipes first, then mirrors every shared recipe with the
  // module pre-bound — so `sm-recipes csm <shared>` works without --module, alongside the
  // top-level `--module` form. cm/csm names are disjoint from shared, so no collisions.
  const cm = new Command('cm').description('cm recipes + shared recipes (module forced to cm)');
  for (const desc of [...cmCommands, ...withModule(sharedCommands, 'cm')])
    cm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(cm);

  const csm = new Command('csm').description('csm recipes + shared recipes (module forced to csm)');
  for (const desc of [...csmCommands, ...withModule(sharedCommands, 'csm')])
    csm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(csm);

  showGlobals(program);

  return program;
}
