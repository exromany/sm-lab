import { Command } from 'commander';
import { makeIcs as realMakeIcs, makeStrikes as realMakeStrikes } from '../pipelines';
import type { MakeResult } from '../pipelines';

/** Injectable seam: tests pass fake pipelines so CLI parsing is verified hermetically. */
export interface CliDeps {
  makeIcs: typeof realMakeIcs;
  makeStrikes: typeof realMakeStrikes;
}

/** Wrap an async action so thrown errors print cleanly and exit non-zero. */
function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

function report(label: string, result: MakeResult): void {
  console.log(`${label} tree root: ${result.treeRoot}`);
  console.log(`${label} tree CID:  ${result.treeCid ?? '(upload skipped)'}`);
  if (result.configPath) console.log(`Wrote ${result.configPath}`);
}

export function buildProgram(
  deps: CliDeps = { makeIcs: realMakeIcs, makeStrikes: realMakeStrikes },
): Command {
  const program = new Command()
    .name('sm-merkle')
    .description('Lido CSM Merkle tree builder — build a tree, pin it to IPFS, print root + CID')
    // We ship our own `help` command below; suppress the built-in to avoid a duplicate-command
    // collision. `.helpCommand(false)` is the non-deprecated replacement for `.addHelpCommand(false)`.
    .helpCommand(false);

  program
    .command('ics')
    .description('Build the ICS address tree, pin it to IPFS, print root + CID')
    .argument('<addresses>', 'path to addresses.json (JSON array) or newline-delimited .txt')
    .option('--no-upload', 'build/print root only, skip IPFS pinning')
    .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
    .action((addresses: string, opts: { upload: boolean; out?: string }) => {
      run(async () => {
        report(
          'ICS',
          await deps.makeIcs(addresses, { noUpload: !opts.upload, configPath: opts.out }),
        );
      });
    });

  program
    .command('strikes')
    .description('Build the strikes tree, pin it to IPFS, print root + CID')
    .argument('<strikes>', 'path to strikes.json')
    .option('--no-upload', 'build/print root only, skip IPFS pinning')
    .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
    .action((strikes: string, opts: { upload: boolean; out?: string }) => {
      run(async () => {
        report(
          'Strikes',
          await deps.makeStrikes(strikes, { noUpload: !opts.upload, configPath: opts.out }),
        );
      });
    });

  program
    .command('help')
    .description('Print a self-contained usage cheat sheet')
    .action(() => {
      console.log(`sm-merkle — Lido CSM Merkle tree builder

WHAT IT DOES
  Build a Merkle tree from input, pin it to IPFS, and print the root + CID.
  Pushing the root/CID on-chain is NOT this tool's job — that's @sm-lab/receipts.

COMMANDS
  ics <addresses>      build the ICS address tree, pin to IPFS, print root + CID
  strikes <strikes>    build the strikes tree, pin to IPFS, print root + CID

FLAGS
  --no-upload          build/print the root only, skip IPFS pinning
  -o, --out <path>     also write { treeRoot, treeCid } JSON to <path>

ENV
  IPFS_API_URL         pinning endpoint; unset → real Pinata (https://api.pinata.cloud).
                       Point at @sm-lab/ipfs locally (e.g. http://127.0.0.1:3000) —
                       a custom endpoint pins without Pinata credentials.
  PINATA_API_KEY/SECRET   Pinata credentials (or PINATA_JWT). Ignored by the mock.

DATA FORMATS
  addresses    JSON array ["0x..", ...] or newline-delimited text (# comments ok)
  strikes      JSON array [{ nodeOperatorId, pubkey, strikes: number[] }]`);
    });

  return program;
}
