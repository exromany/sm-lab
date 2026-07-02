import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { setShutdownHandler } from './admin';
import { loadStateFromFile, saveStateToFile } from './state';

export interface StartServerOptions {
  port: number;
  host: string;
  /** Called once the server is listening, with the base URL. Defaults to a generic log line. */
  onListen?: (url: string) => void;
  /**
   * Optional state persistence wiring.
   * If `statePath` is set and the file exists at boot, `restore` is called with its contents.
   * On graceful shutdown, `snapshot` is called and the result is saved to `statePath`.
   * All three fields must be provided together; omit the whole object to skip state wiring.
   */
  statePath?: string;
  snapshot?: () => unknown;
  restore?: (s: unknown) => void;
}

/**
 * Boot a Hono app on Node with graceful shutdown wired up — the scaffold every sm-lab
 * service shared verbatim. Builds a shutdown closure (close server → exit 0), registers it
 * for `POST /admin/shutdown` via setShutdownHandler, and binds SIGINT/SIGTERM to it.
 *
 * Optionally wires state persistence: restores from `statePath` on boot (if the file exists),
 * and saves to `statePath` on graceful shutdown.
 */
export function startServer(app: Hono, opts: StartServerOptions): ReturnType<typeof serve> {
  const { port, host, onListen, statePath, snapshot, restore } = opts;

  // Restore persisted state before accepting connections.
  // A corrupt or truncated file must not prevent the server from starting —
  // degrade to an empty store and warn instead of crashing.
  if (statePath && restore) {
    try {
      const saved = loadStateFromFile(statePath);
      if (saved !== undefined) restore(saved);
    } catch (err) {
      console.warn(
        `[state] Failed to restore state from "${statePath}": ${err instanceof Error ? err.message : String(err)}. Starting with empty store.`,
      );
    }
  }

  const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
    const url = `http://${host}:${port}`;
    if (onListen) onListen(url);
    else console.log(`Server listening on ${url}`);
  });

  const shutdown = (): void => {
    console.log('Shutting down...');
    if (statePath && snapshot) {
      try {
        saveStateToFile(statePath, snapshot());
      } catch (err) {
        console.error('Failed to save state on shutdown:', err);
      }
    }
    server.close(() => process.exit(0));
  };

  setShutdownHandler(shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
