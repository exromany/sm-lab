import { Command } from 'commander';
import { connect } from '../context';
import { defineCommand } from './define';
import { sharedCommands } from './commands/shared';
import { cmCommands } from './commands/cm';
import { csmCommands } from './commands/csm';

export function buildProgram(connectImpl: typeof connect = connect): Command {
  const program = new Command()
    .name('csm-recipes')
    .description('Prepare CSM on-chain state on an anvil fork (run-and-exit recipes)')
    .option('--rpc-url <url>', 'anvil fork RPC URL (default: $RPC_URL)')
    .option('--module <csm|cm>', 'target module for shared commands')
    .option('--cl-mock-url <url>', 'cl-mock URL for cl-activate (default: $CL_MOCK_URL)')
    .option('--json', 'emit the raw result as JSON')
    .addHelpCommand(false);

  for (const desc of sharedCommands) program.addCommand(defineCommand(desc, connectImpl));

  const cm = new Command('cm').description('cm-only recipes (module forced to cm)');
  for (const desc of cmCommands) cm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(cm);

  const csm = new Command('csm').description('csm-only recipes (module forced to csm)');
  for (const desc of csmCommands) csm.addCommand(defineCommand(desc, connectImpl));
  program.addCommand(csm);

  return program;
}
