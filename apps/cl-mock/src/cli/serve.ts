import { Command } from 'commander';
import { DEFAULT_PORT, DEFAULT_HOST } from '../types';

export const serveCommand = new Command('serve')
  .description('Start the CL mock server')
  .option('-p, --port <port>', 'server port', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'server host', DEFAULT_HOST)
  .action(async (opts) => {
    const { startServer } = await import('../server/app');
    startServer(Number(opts.port), opts.host);
  });
