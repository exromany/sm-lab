import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { setShutdownHandler } from './admin';

export interface StartServerOptions {
  port: number;
  host: string;
  /** Called once the server is listening, with the base URL. Defaults to a generic log line. */
  onListen?: (url: string) => void;
}

/**
 * Boot a Hono app on Node with graceful shutdown wired up — the scaffold every csm-lab
 * service shared verbatim. Builds a shutdown closure (close server → exit 0), registers it
 * for `POST /admin/shutdown` via setShutdownHandler, and binds SIGINT/SIGTERM to it.
 */
export function startServer(app: Hono, opts: StartServerOptions): ReturnType<typeof serve> {
  const { port, host, onListen } = opts;

  const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
    const url = `http://${host}:${port}`;
    if (onListen) onListen(url);
    else console.log(`Server listening on ${url}`);
  });

  const shutdown = (): void => {
    console.log('Shutting down...');
    server.close(() => process.exit(0));
  };

  setShutdownHandler(shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
