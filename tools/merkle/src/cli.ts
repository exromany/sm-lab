#!/usr/bin/env node

// eslint-disable-next-line import/no-unassigned-import -- side-effect import: loads .env
import 'dotenv/config';
import { Command } from 'commander';
import { makeIcs, makeStrikes, type MakeResult } from './pipelines';

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

const program = new Command()
  .name('csm-merkle')
  .description('Lido CSM Merkle tree builder — build a tree, pin it to IPFS, print root + CID')
  .addHelpCommand(false);

program
  .command('ics')
  .description('Build the ICS address tree, pin it to IPFS, print root + CID')
  .argument('<addresses>', 'path to addresses.json (JSON array) or newline-delimited .txt')
  .option('--no-upload', 'build/print root only, skip IPFS pinning')
  .option('-o, --out <path>', 'also write { treeRoot, treeCid } JSON to this path')
  .action((addresses: string, opts: { upload: boolean; out?: string }) => {
    run(async () => {
      report('ICS', await makeIcs(addresses, { noUpload: !opts.upload, configPath: opts.out }));
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
        await makeStrikes(strikes, { noUpload: !opts.upload, configPath: opts.out }),
      );
    });
  });

program
  .command('help')
  .description('Print a self-contained usage cheat sheet')
  .action(() => {
    console.log(`csm-merkle — Lido CSM Merkle tree builder

WHAT IT DOES
  Build a Merkle tree from input, pin it to IPFS, and print the root + CID.
  Pushing the root/CID on-chain is NOT this tool's job — that's @csm-lab/receipts.

COMMANDS
  ics <addresses>      build the ICS address tree, pin to IPFS, print root + CID
  strikes <strikes>    build the strikes tree, pin to IPFS, print root + CID

FLAGS
  --no-upload          build/print the root only, skip IPFS pinning
  -o, --out <path>     also write { treeRoot, treeCid } JSON to <path>

ENV
  IPFS_API_URL         pinning endpoint; unset → real Pinata (https://api.pinata.cloud).
                       Point at @csm-lab/ipfs-mock locally (e.g. http://127.0.0.1:3000) —
                       a custom endpoint pins without Pinata credentials.
  PINATA_API_KEY/SECRET   Pinata credentials (or PINATA_JWT). Ignored by the mock.

DATA FORMATS
  addresses    JSON array ["0x..", ...] or newline-delimited text (# comments ok)
  strikes      JSON array [{ nodeOperatorId, pubkey, strikes: number[] }]`);
  });

program.parse();
