import { Command, Option } from 'commander';
import { createCompletionCommand, readPackageVersion } from '@sm-lab/core';
import { makeDepositKeys as realMakeDepositKeys } from '../keys';
import { CHAINS } from '../constants';
import type { ChainName, WcType } from '../constants';
import { toDepositDataJson, writeDepositDataFile } from '../io';

const CHAIN_CHOICES = Object.keys(CHAINS) as ChainName[];
const WC_TYPE_CHOICES: WcType[] = ['0x01', '0x02'];

/** Injectable seam: tests pass a fake keygen so CLI parsing is verified hermetically. */
export interface CliDeps {
  makeDepositKeys: typeof realMakeDepositKeys;
}

/** Serialize bigint values to decimal strings; all other values pass through. */
export const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

/** Run an async action; print thrown errors to stderr and exit 1. */
function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export function buildProgram(deps: CliDeps = { makeDepositKeys: realMakeDepositKeys }): Command {
  return (
    new Command()
      .name('sm-keys')
      .description(
        'Generate real BLS validator deposit data for Lido SM (mainnet/hoodi); ' +
          'human mode: deposit_data.json to stdout (or --out); mnemonic only in --json',
      )
      .version(readPackageVersion(import.meta.url))
      .addOption(
        new Option('--chain <name>', 'target chain').choices(CHAIN_CHOICES).default('hoodi'),
      )
      .option('--count <n>', 'number of validators', '1')
      .addOption(
        new Option('--type <wc>', 'withdrawal credentials type')
          .choices(WC_TYPE_CHOICES)
          .default('0x01'),
      )
      .option('--mnemonic <phrase>', 'BIP-39 mnemonic (random if omitted)')
      .option('--wc <address>', 'override withdrawal address (default: Lido vault)')
      .option('--start-index <n>', 'first validator index', '0')
      .option('-o, --out <path>', 'write deposit_data.json to <path> (else stdout)')
      .option('--json', 'emit result as JSON to stdout (mnemonic + keys with 0x-prefixed hex)')
      .addHelpText(
        'after',
        `
Examples:
  sm-keys 2 --json
  sm-keys --count 5 --chain mainnet --json
  sm-keys --json --out deposit_data.json`,
      )
      // `sm-keys 2` == `sm-keys --count 2`; the positional wins when both are given.
      .argument('[count]', 'number of validators (positional alias for --count)')
      // `sm-keys help` mirrors `--help` (matches the sm-recipes CLI).
      .helpCommand(true)
      .addCommand(createCompletionCommand())
      .action(
        (
          countArg: string | undefined,
          opts: {
            chain: string;
            count: string;
            type: string;
            mnemonic?: string;
            wc?: string;
            startIndex: string;
            out?: string;
            json?: boolean;
          },
        ) => {
          run(async () => {
            const result = await deps.makeDepositKeys({
              chain: opts.chain as ChainName,
              count: Number(countArg ?? opts.count),
              type: opts.type as WcType,
              mnemonic: opts.mnemonic,
              withdrawalAddress: opts.wc as `0x${string}` | undefined,
              startIndex: Number(opts.startIndex),
            });
            const { keys } = result;

            if (opts.json) {
              // The mnemonic is a secret: it's emitted ONLY here, in the --json payload.
              // Human mode never prints it (nothing to stderr) — opt in with --json to get it.
              console.log(JSON.stringify(result, bigintReplacer, 2));
              return;
            }

            // Human mode: only the deposit data — no mnemonic anywhere.
            if (opts.out) {
              writeDepositDataFile(opts.out, keys);
              console.error(`wrote ${keys.length} key(s) to ${opts.out}`);
            } else {
              console.log(toDepositDataJson(keys));
            }
          });
        },
      )
  );
}
