import { Command } from 'commander';
import { resolveUrl as coreResolveUrl } from '@csm-lab/core';
import { VALIDATOR_STATUSES, DEFAULT_PORT, isValidStatus } from '../types';

const resolveUrl = (cmd: Command): string =>
  coreResolveUrl(cmd, { envVar: 'CL_MOCK_URL', defaultPort: DEFAULT_PORT });

async function request(url: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${url}${path}`, init).catch((err) => {
    console.error(`Failed to connect to ${url}: ${err.message}`);
    process.exit(1);
  });
  return res;
}

/** Parse ETH (decimal string) → gwei (integer string). Throws on invalid input. */
function ethToGwei(eth: string): string {
  if (!/^\d+(\.\d+)?$/.test(eth)) {
    throw new Error(`'${eth}' is not a non-negative decimal number`);
  }
  // regex above guarantees a non-empty integer part; default keeps TS happy under noUncheckedIndexedAccess
  const [intPart = '0', fracPart = ''] = eth.split('.');
  if (fracPart.length > 9) {
    throw new Error(`'${eth}' has more than 9 fractional digits (gwei precision)`);
  }
  const padded = fracPart.padEnd(9, '0');
  return (BigInt(intPart) * 10n ** 9n + BigInt(padded)).toString();
}

/** Format gwei (integer string) back to a human ETH string. */
function gweiToEth(gwei: string): string {
  const padded = gwei.padStart(10, '0');
  const intPart = padded.slice(0, -9).replace(/^0+(?=\d)/, '');
  const fracPart = padded.slice(-9).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export const configCommand = new Command('config').description(
  'Configure validators on a running CL mock server',
);

configCommand
  .command('set')
  .description('Set a validator status (and optionally effective balance in ETH)')
  .argument('<pubkey>', 'validator public key (0x-prefixed, 96 hex chars)')
  .argument('[status]', `validator status`)
  .argument(
    '[effective-balance]',
    'effective balance in ETH (e.g. 32, 31.5); defaults to 32 if omitted',
  )
  .action(
    async (
      pubkey: string,
      status: string | undefined,
      effectiveBalanceEth: string | undefined,
      _opts,
      cmd: Command,
    ) => {
      if (!status || !isValidStatus(status)) {
        console.error(status ? `Unknown status: ${status}` : 'Missing status argument');
        console.error('Available statuses:');
        for (const s of VALIDATOR_STATUSES) console.error(`  ${s}`);
        process.exit(1);
      }
      let effectiveBalanceGwei: string | undefined;
      if (effectiveBalanceEth !== undefined) {
        try {
          effectiveBalanceGwei = ethToGwei(effectiveBalanceEth);
        } catch (err) {
          console.error(`Invalid effective-balance: ${(err as Error).message}`);
          process.exit(1);
        }
      }
      const url = resolveUrl(cmd);
      const body: Record<string, string> = { pubkey, status };
      if (effectiveBalanceGwei !== undefined) {
        body.effective_balance = effectiveBalanceGwei;
      }
      const res = await request(url, '/admin/validators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { accepted?: number; errors?: string[] };
      if (!res.ok && res.status !== 207) {
        console.error('Error:', JSON.stringify(data.errors ?? data, null, 2));
        process.exit(1);
      }
      if (data.errors?.length) {
        console.warn('Warnings:', data.errors.join(', '));
      }
      const suffix =
        effectiveBalanceGwei !== undefined ? ` (${gweiToEth(effectiveBalanceGwei)} ETH)` : '';
      console.log(`Set ${pubkey.slice(0, 18)}...${pubkey.slice(-6)} → ${status}${suffix}`);
    },
  );

configCommand
  .command('list')
  .description('List all configured validators')
  .action(async (_opts, cmd: Command) => {
    const url = resolveUrl(cmd);
    const res = await request(url, '/admin/validators');
    const data = (await res.json()) as Array<{
      pubkey: string;
      status: string;
      effective_balance?: string;
    }>;
    if (data.length === 0) {
      console.log('(empty)');
      return;
    }
    for (const { pubkey, status, effective_balance } of data) {
      const eb = effective_balance ? `  eb=${gweiToEth(effective_balance)} ETH` : '';
      console.log(`${pubkey.slice(0, 18)}...${pubkey.slice(-6)}  ${status}${eb}`);
    }
  });

configCommand
  .command('reset')
  .description('Clear all validator state')
  .action(async (_opts, cmd: Command) => {
    const url = resolveUrl(cmd);
    await request(url, '/admin/validators', { method: 'DELETE' });
    console.log('State cleared');
  });

configCommand
  .command('remove')
  .description('Remove a single validator')
  .argument('<pubkey>', 'validator public key')
  .action(async (pubkey: string, _opts, cmd: Command) => {
    const url = resolveUrl(cmd);
    await request(url, `/admin/validators/${encodeURIComponent(pubkey)}`, {
      method: 'DELETE',
    });
    console.log(`Removed ${pubkey.slice(0, 18)}...${pubkey.slice(-6)}`);
  });

configCommand
  .command('statuses')
  .description('Print valid validator statuses')
  .action(() => {
    for (const s of VALIDATOR_STATUSES) {
      console.log(s);
    }
  });
