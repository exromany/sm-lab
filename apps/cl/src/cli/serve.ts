import { Command } from 'commander';
import { DEFAULT_PORT, DEFAULT_HOST } from '../types';

export const serveCommand = new Command('serve')
  .description(
    'Start the Beacon API mock in the foreground (in-memory; Ctrl+C or `sm-cl stop` to exit). ' +
      '--state <file> loads validators on boot and saves on shutdown; --upstream <url> ' +
      'proxies-and-caches a real CL API for unconfigured pubkeys',
  )
  .option('-p, --port <port>', 'server port', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'server host', DEFAULT_HOST)
  .option('--state <file>', 'state persistence file (env: CL_MOCK_STATE)')
  .option(
    '--upstream <url>',
    'upstream Beacon API base URL for cached proxy (env: CL_UPSTREAM_URL)',
  )
  .action(async (opts) => {
    const { startServer } = await import('../server/app');
    const statePath: string | undefined = opts.state ?? process.env['CL_MOCK_STATE'];
    const upstreamUrl: string | undefined = opts.upstream ?? process.env['CL_UPSTREAM_URL'];
    startServer(Number(opts.port), opts.host, {
      port: Number(opts.port),
      host: opts.host,
      statePath,
      upstreamUrl,
    });
  });
