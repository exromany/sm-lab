import { fileURLToPath } from 'node:url';

/** RPC env vars, in resolution order — reused from the repo's .env.sample conventions. */
export const RPC_ENV_VARS = ['MAINNET_RPC_URL', 'ANVIL_FORK_URL', 'ETH_RPC_URL'] as const;

/** The mainnet block the baked state was dumped at; the fork base must match it. */
export const DEFAULT_FORK_BLOCK = '25523407';

type Env = Record<string, string | undefined>;

/** First non-empty of MAINNET_RPC_URL → ANVIL_FORK_URL → ETH_RPC_URL, else undefined. */
export function resolveRpc(env: Env): string | undefined {
  for (const key of RPC_ENV_VARS) {
    const value = env[key];
    if (value) return value;
  }
  return undefined;
}

/** The fork base block — ANVIL_FORK_BLOCK override, else the baked snapshot's block. */
export function resolveForkBlock(env: Env): string {
  return env.ANVIL_FORK_BLOCK || DEFAULT_FORK_BLOCK;
}

/** Path to the baked state — ANVIL_STATE_FILE override, else the file shipped in the package. */
export function findStatePath(env: Env): string {
  if (env.ANVIL_STATE_FILE) return env.ANVIL_STATE_FILE;
  // `../state/…` resolves to <package>/state from both src/ (tests) and flat dist/ (runtime).
  return fileURLToPath(new URL('../state/mainnet-upgraded.state.json', import.meta.url));
}

/** The anvil argument vector: managed fork+state flags, then the user's passthrough flags. */
export function buildAnvilArgs(opts: {
  rpc: string;
  forkBlock: string;
  statePath: string;
  passthrough: string[];
}): string[] {
  return [
    '--fork-url',
    opts.rpc,
    '--fork-block-number',
    opts.forkBlock,
    '--load-state',
    opts.statePath,
    ...opts.passthrough,
  ];
}
