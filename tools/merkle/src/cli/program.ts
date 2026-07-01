import { Command } from 'commander';
import {
  makeIcs as realMakeIcs,
  makeStrikes as realMakeStrikes,
  makeRewards as realMakeRewards,
} from '../pipelines';
import { readAddressFile, readJsonFile } from '../io';
import type { MakeResult } from '../pipelines';

/** Injectable seam: tests pass fake pipelines so CLI parsing is verified hermetically. */
export interface CliDeps {
  makeIcs: (addresses: string[], opts: Parameters<typeof realMakeIcs>[1]) => Promise<MakeResult>;
  makeStrikes: typeof realMakeStrikes;
  makeRewards: typeof realMakeRewards;
}

/** Wrap an async action so thrown errors print cleanly and exit non-zero. */
function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

function report(label: string, result: MakeResult & { logCid?: string }): void {
  console.log(`${label} tree root: ${result.treeRoot}`);
  console.log(`${label} tree CID:  ${result.treeCid ?? '(upload skipped)'}`);
  if (result.logCid) console.log(`${label} log  CID:  ${result.logCid}`);
  if (result.configPath) console.log(`Wrote ${result.configPath}`);
}

export function buildProgram(
  deps: CliDeps = {
    makeIcs: realMakeIcs,
    makeStrikes: realMakeStrikes,
    makeRewards: realMakeRewards,
  },
): Command {
  const program = new Command()
    .name('sm-merkle')
    .description('Lido CSM Merkle tree builder — build a tree, pin it to IPFS, print root + CID')
    // We ship our own `help` command below; suppress the built-in to avoid a duplicate-command
    // collision. `.helpCommand(false)` is the non-deprecated replacement for `.addHelpCommand(false)`.
    .helpCommand(false);

  // ---------------------------------------------------------------------------
  // `addresses` — default command (bare `sm-merkle 0x.. 0x..` routes here)
  // ---------------------------------------------------------------------------
  program
    .command('addresses', { isDefault: true })
    .description('Build the ICS address tree, pin it to IPFS, print root + CID')
    .argument('[addresses...]', 'whitelist addresses (inline, or use --input / --source)')
    .option(
      '--input <addr>',
      'repeatable: add one address to the list',
      (v: string, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .option('--source <file>', 'load address list from a JSON array or newline-delimited .txt')
    .option('--no-upload', 'build/print root only, skip IPFS pinning')
    .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
    .option('--json', 'print result as JSON to stdout (machine-readable)')
    .action(
      (
        positionals: string[],
        opts: {
          input: string[];
          source?: string;
          upload: boolean;
          out?: string;
          json?: boolean;
        },
      ) => {
        run(async () => {
          const hasInline = positionals.length > 0 || opts.input.length > 0;
          const hasFile = Boolean(opts.source);
          if (hasInline && hasFile) {
            throw new Error(
              'Cannot combine inline addresses (positionals / --input) with --source <file>. Use one or the other.',
            );
          }
          let addresses: string[];
          if (hasFile) {
            addresses = readAddressFile(opts.source!);
          } else {
            addresses = [...positionals, ...opts.input];
          }
          if (addresses.length === 0) {
            throw new Error(
              'No addresses supplied. Provide positional addresses, --input <addr>, or --source <file>.',
            );
          }
          const result = await deps.makeIcs(addresses, {
            noUpload: !opts.upload,
            configPath: opts.out,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, bigintReplacer, 2));
          } else {
            report('ICS', result);
          }
        });
      },
    );

  // ---------------------------------------------------------------------------
  // `strikes`
  // ---------------------------------------------------------------------------
  program
    .command('strikes')
    .description('Build the strikes tree, pin it to IPFS, print root + CID')
    .argument('<strikes>', 'path to strikes.json')
    .option('--source <file>', 'alternative flag for the strikes file path (same as positional)')
    .option('--no-upload', 'build/print root only, skip IPFS pinning')
    .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
    .option('--json', 'print result as JSON to stdout (machine-readable)')
    .action(
      (
        strikesArg: string,
        opts: { source?: string; upload: boolean; out?: string; json?: boolean },
      ) => {
        run(async () => {
          const strikesPath = opts.source ?? strikesArg;
          const result = await deps.makeStrikes(strikesPath, {
            noUpload: !opts.upload,
            configPath: opts.out,
          });
          if (opts.json) {
            console.log(JSON.stringify(result, bigintReplacer, 2));
          } else {
            report('Strikes', result);
          }
        });
      },
    );

  // ---------------------------------------------------------------------------
  // `rewards`
  // ---------------------------------------------------------------------------
  program
    .command('rewards')
    .description('Build the rewards tree from [nodeOperatorId, cumulativeShares] pairs, pin it')
    .option(
      '--source <file>',
      'JSON array of [nodeOperatorId, cumulativeShares] pairs (number or numeric-string)',
    )
    .option('--no-upload', 'build/print root only, skip IPFS pinning')
    .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
    .option('--json', 'print result as JSON to stdout (machine-readable)')
    .action((opts: { source?: string; upload: boolean; out?: string; json?: boolean }) => {
      run(async () => {
        if (!opts.source) {
          throw new Error('--source <file> is required for the rewards command.');
        }
        const raw = readJsonFile<[unknown, unknown][]>(opts.source);
        if (raw.length === 0) {
          throw new Error(
            'No leaves supplied. Provide a non-empty JSON array of [nodeOperatorId, cumulativeShares] pairs.',
          );
        }
        const leaves: [bigint, bigint][] = raw.map(([noId, shares], i) => {
          const toBig = (v: unknown, field: string): bigint => {
            if (typeof v === 'bigint') return v;
            if (typeof v === 'number' || typeof v === 'string') return BigInt(v);
            throw new Error(
              `rewards --source: entry [${i}].${field} must be a number or numeric string, got ${typeof v}`,
            );
          };
          return [toBig(noId, '0'), toBig(shares, '1')];
        });
        const result = await deps.makeRewards(leaves, {
          noUpload: !opts.upload,
          configPath: opts.out,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, bigintReplacer, 2));
        } else {
          report('Rewards', result);
        }
      });
    });

  // ---------------------------------------------------------------------------
  // `help` — self-contained cheat sheet
  // ---------------------------------------------------------------------------
  program
    .command('help')
    .description('Print a self-contained usage cheat sheet')
    .action(() => {
      console.log(`sm-merkle — Lido CSM Merkle tree builder

WHAT IT DOES
  Build a Merkle tree from input, pin it to IPFS, and print the root + CID.
  Pushing the root/CID on-chain is NOT this tool's job — that's @sm-lab/receipts.

COMMANDS
  addresses [addresses...]   build the ICS address tree (DEFAULT — bare args route here)
  strikes <strikes>          build the strikes tree, pin to IPFS, print root + CID
  rewards --source <file>    build the rewards tree from [noId, cumulativeShares] pairs
  help                       print this cheat sheet

FLAGS (all commands)
  --no-upload          build/print the root only, skip IPFS pinning
  -o, --out <path>     also write { treeRoot, treeCid } JSON to <path>
  --json               print result as a single JSON value to stdout (machine-readable)

FLAGS (addresses only)
  --input <addr>       repeatable: add one address (can mix with positionals)
  --source <file>      load from JSON array ["0x.."] or newline-delimited .txt
                       (mutually exclusive with inline positionals / --input)

ENV
  IPFS_API_URL         pinning endpoint; unset → local @sm-lab/ipfs (http://127.0.0.1:5001).
                       Pinata used only when PINATA_* creds are set (and IPFS_API_URL is unset).
  PINATA_API_KEY/SECRET   Pinata credentials (or PINATA_JWT). Ignored by the mock.

DATA FORMATS
  addresses    JSON array ["0x..", ...] or newline-delimited text (# comments ok)
  strikes      JSON array [{ nodeOperatorId, pubkey, strikes: number[] }]
  rewards      JSON array [[nodeOperatorId, cumulativeShares], ...] (numbers or numeric strings)

EXAMPLES
  sm-merkle 0xABC 0xDEF                        # inline addresses → ICS tree
  sm-merkle addresses --source addrs.json --json
  sm-merkle addresses --input 0xABC --input 0xDEF --no-upload
  sm-merkle strikes strikes.json --no-upload --json
  sm-merkle rewards --source rewards.json --json
  sm-merkle addresses addrs.json -o config.json`);
    });

  return program;
}
