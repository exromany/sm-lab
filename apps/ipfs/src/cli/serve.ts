import { Command } from 'commander';
import { DEFAULT_HOST, DEFAULT_PORT } from '../types';

export const serveCommand = new Command('serve')
  .description('Start the IPFS mock server (pinning API + gateway)')
  .option('-p, --port <port>', 'server port', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'server host', DEFAULT_HOST)
  .option('-g, --gateway <url>', 'upstream IPFS gateway for store-miss CIDs (overrides env)')
  .option('--persist <dir>', 'persist pins to a directory (survives restarts)')
  .option(
    '--state <file>',
    'JSON state file: load on boot, save on graceful shutdown (env: IPFS_MOCK_STATE)',
  )
  .action(
    async (opts: {
      port: string;
      host: string;
      gateway?: string;
      persist?: string;
      state?: string;
    }) => {
      const { startServer } = await import('../server/app');
      startServer({
        port: Number(opts.port),
        host: opts.host,
        gateway: opts.gateway,
        persist: opts.persist,
        statePath: opts.state ?? process.env['IPFS_MOCK_STATE'],
      });
    },
  );
