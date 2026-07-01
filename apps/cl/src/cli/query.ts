import { Command } from 'commander';
import { resolveUrl as coreResolveUrl } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

const resolveUrl = (cmd: Command): string =>
  coreResolveUrl(cmd, { envVar: 'CL_MOCK_URL', defaultPort: DEFAULT_PORT });

async function get(fetchImpl: typeof fetch, url: string, path: string): Promise<Response> {
  return fetchImpl(`${url}${path}`).catch((err) => {
    console.error(`Failed to connect to ${url}: ${(err as Error).message}`);
    process.exit(1);
  });
}

export function buildQueryCommand(fetchImpl: typeof fetch = fetch): Command {
  return new Command('query')
    .description('Query beacon validators endpoint and print the JSON response')
    .argument('[pubkeys...]', 'validator pubkeys (omit to query all configured validators)')
    .option('--state <id>', 'beacon state id', 'head')
    .option('--json', 'output raw JSON (machine-parseable)')
    .action(async (pubkeys: string[], opts: { state: string; json?: boolean }, cmd: Command) => {
      const url = resolveUrl(cmd);

      let ids = pubkeys;
      if (ids.length === 0) {
        const res = await get(fetchImpl, url, '/admin/validators');
        const list = (await res.json()) as Array<{ pubkey: string; status: string }>;
        ids = list.map((v) => v.pubkey);
      }

      const path =
        `/eth/v1/beacon/states/${encodeURIComponent(opts.state)}/validators` +
        (ids.length ? `?id=${ids.map(encodeURIComponent).join(',')}` : '');

      const res = await get(fetchImpl, url, path);
      const data = await res.json();

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Human mode: one line per validator; fall back to raw JSON on unexpected shape.
      const d = data as { data?: unknown };
      if (!Array.isArray(d.data)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      for (const v of d.data as Array<{
        index?: string;
        balance?: string;
        status?: string;
        validator?: { pubkey?: string };
      }>) {
        const pubkey = v.validator?.pubkey ?? '(unknown)';
        const status = v.status ?? '(unknown)';
        const balance = v.balance ?? '(unknown)';
        console.log(`${pubkey}  ${status}  ${balance}`);
      }
    });
}

export const queryCommand = buildQueryCommand();
