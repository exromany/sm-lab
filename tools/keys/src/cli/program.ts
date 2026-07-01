import { Command } from 'commander';
import { makeDepositKeys as realMakeDepositKeys } from '../keys';
import type { ChainName, WcType } from '../constants';
import { toDepositDataJson, writeDepositDataFile } from '../io';

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
      .description('Generate real BLS validator deposit data for Lido CSM (mainnet/hoodi)')
      .option('--chain <name>', 'mainnet | hoodi', 'hoodi')
      .option('--count <n>', 'number of validators', '1')
      .option('--type <wc>', 'withdrawal credentials type: 0x01 | 0x02', '0x01')
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
            const { mnemonic, keys } = result;

            if (opts.json) {
              // --json: single structured value to stdout; mnemonic is included in the result.
              // Exit code 0. Nothing else on stdout.
              console.log(JSON.stringify(result, bigintReplacer, 2));
              return;
            }

            // Human mode: mnemonic to stderr so stdout / -o stays clean JSON.
            console.error(`mnemonic: ${mnemonic}`);
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
