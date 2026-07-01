import { Command } from 'commander';
import { resolveUrl as coreResolveUrl } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

const resolveUrl = (cmd: Command): string =>
  coreResolveUrl(cmd, { envVar: 'CL_MOCK_URL', defaultPort: DEFAULT_PORT });

async function get(url: string, path: string): Promise<Response> {
  return fetch(`${url}${path}`).catch((err) => {
    console.error(`Failed to connect to ${url}: ${err.message}`);
    process.exit(1);
  });
}

export const queryCommand = new Command('query')
  .description('Query beacon validators endpoint and print the JSON response')
  .argument('[pubkeys...]', 'validator pubkeys (omit to query all configured validators)')
  .option('--state <id>', 'beacon state id', 'head')
  .action(async (pubkeys: string[], opts: { state: string }, cmd: Command) => {
    const url = resolveUrl(cmd);

    let ids = pubkeys;
    if (ids.length === 0) {
      const res = await get(url, '/admin/validators');
      const list = (await res.json()) as Array<{ pubkey: string; status: string }>;
      ids = list.map((v) => v.pubkey);
    }

    const path =
      `/eth/v1/beacon/states/${encodeURIComponent(opts.state)}/validators` +
      (ids.length ? `?id=${ids.map(encodeURIComponent).join(',')}` : '');

    const res = await get(url, path);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  });
