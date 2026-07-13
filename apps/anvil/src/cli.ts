#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  buildAnvilArgs,
  findStatePath,
  resolveForkBlock,
  resolveRpc,
  RPC_ENV_VARS,
} from './launch';

const USAGE = `sm-anvil — anvil forking mainnet with the Lido SM upgrade state overlaid.

  sm-anvil [anvil flags...]        e.g. sm-anvil --host 0.0.0.0 --port 8545

All flags pass straight through to anvil (see \`anvil --help\`).

Requires:
  - Foundry (the \`anvil\` binary) on PATH — https://getfoundry.sh
  - a mainnet ARCHIVE RPC via one of ${RPC_ENV_VARS.join(', ')} (read from the
    environment or a .env in the current directory); it must serve the fork block.

Overrides: ANVIL_FORK_BLOCK (fork base block), ANVIL_STATE_FILE (state dump path).`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);

if (argv[0] === '-h' || argv[0] === '--help') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

// Capture the caller's environment before loading .env, so an explicit env var wins over
// the file (standard dotenv precedence — the file only fills what the caller left unset).
const caller = { ...process.env };
try {
  process.loadEnvFile();
} catch {
  // No .env in the current directory — that's fine.
}
const env = { ...process.env, ...caller };

const rpc = resolveRpc(env);
const forkBlock = resolveForkBlock(env);
const statePath = findStatePath(env);

if (!rpc) {
  fail(
    `Error: no mainnet archive RPC configured.\n` +
      `  Set one of ${RPC_ENV_VARS.join(', ')} in the environment or a .env file.\n` +
      `  It must be a mainnet *archive* node able to serve block ${forkBlock}.`,
  );
}
if (!existsSync(statePath)) {
  fail(`Error: state file not found: ${statePath}`);
}

process.stderr.write(`anvil ← mainnet fork @ ${forkBlock} + baked SM upgrade state\n`);

const child = spawn('anvil', buildAnvilArgs({ rpc, forkBlock, statePath, passthrough: argv }), {
  stdio: 'inherit',
});

child.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'ENOENT') {
    fail('Error: anvil not found. Install Foundry: https://getfoundry.sh');
  }
  fail(`Error: failed to start anvil: ${err.message}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
