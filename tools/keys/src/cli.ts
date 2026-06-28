#!/usr/bin/env node

import { Command } from 'commander';
import { makeDepositKeys } from './keys';
import type { ChainName, WcType } from './constants';
import { toDepositDataJson, writeDepositDataFile } from './io';

const program = new Command()
  .name('csm-keys')
  .description('Generate real BLS validator deposit data for Lido CSM (mainnet/hoodi)')
  .option('--chain <name>', 'mainnet | hoodi', 'hoodi')
  .option('--count <n>', 'number of validators', '1')
  .option('--type <wc>', 'withdrawal credentials type: 0x01 | 0x02', '0x01')
  .option('--mnemonic <phrase>', 'BIP-39 mnemonic (random if omitted)')
  .option('--wc <address>', 'override withdrawal address (default: Lido vault)')
  .option('--start-index <n>', 'first validator index', '0')
  .option('-o, --out <path>', 'write deposit_data.json to <path> (else stdout)')
  .action(
    async (opts: {
      chain: string;
      count: string;
      type: string;
      mnemonic?: string;
      wc?: string;
      startIndex: string;
      out?: string;
    }) => {
      const { mnemonic, keys } = await makeDepositKeys({
        chain: opts.chain as ChainName,
        count: Number(opts.count),
        type: opts.type as WcType,
        mnemonic: opts.mnemonic,
        withdrawalAddress: opts.wc as `0x${string}` | undefined,
        startIndex: Number(opts.startIndex),
      });
      // Mnemonic to stderr so stdout / -o stays clean JSON.
      console.error(`mnemonic: ${mnemonic}`);
      if (opts.out) {
        writeDepositDataFile(opts.out, keys);
        console.error(`wrote ${keys.length} key(s) to ${opts.out}`);
      } else {
        console.log(toDepositDataJson(keys));
      }
    },
  );

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
