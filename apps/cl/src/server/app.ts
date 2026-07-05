import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  registerAdminRoutes,
  readPackageVersion,
  startServer as coreStartServer,
  registerStateRoutes,
} from '@sm-lab/core';
import { registerBeaconRoutes } from './beacon';
import { registerValidatorRoutes } from './admin';
import { store } from './store';

export interface AppOptions {
  /**
   * Path to the state persistence file.
   * Wires /admin/save + /admin/load and boot-load / shutdown-save.
   */
  statePath?: string;
  /**
   * Upstream Beacon API base URL for the cached proxy.
   * When set, cache misses on the validators read endpoint are fetched from
   * the upstream, stored in the in-memory store, and returned.
   */
  upstreamUrl?: string;
  /** Overridable fetch (injected in tests). */
  fetchFn?: typeof fetch;
}

const snapshot = () => store.snapshot();
const restore = (s: unknown) => store.restore(s);

export function buildApp(opts: AppOptions = {}): Hono {
  const { statePath, upstreamUrl, fetchFn } = opts;

  const app = new Hono();

  // Permissive CORS: this mock backs browser consumers (csm-widget / SDK) cross-origin, so the
  // beacon + validator API must answer preflights and echo Access-Control-Allow-Origin.
  app.use('*', cors());

  registerBeaconRoutes(app, { upstreamUrl, fetchFn });
  registerValidatorRoutes(app);

  registerAdminRoutes(app, {
    version: readPackageVersion(import.meta.url),
    getStatus: () => {
      const byStatus: Record<string, number> = {};
      for (const { entry } of store.list()) {
        byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
      }
      return { validators: { total: store.size, byStatus } };
    },
  });

  // State persistence routes (/admin/save + /admin/load).
  registerStateRoutes(app, { snapshot, restore, defaultPath: statePath });

  return app;
}

// Default singleton app (backward-compatible: no statePath / upstreamUrl).
export const app = buildApp();

export interface StartServerOptions {
  port: number;
  host: string;
  statePath?: string;
  upstreamUrl?: string;
}

/** Boot the CL mock server. Thin wrapper over core's startServer with a cl-mock log line. */
export function startServer(
  port: number,
  host: string,
  opts: StartServerOptions = { port, host },
): ReturnType<typeof coreStartServer> {
  const { statePath, upstreamUrl } = opts;
  const serverApp = buildApp({ statePath, upstreamUrl });

  return coreStartServer(serverApp, {
    port,
    host,
    onListen: (url) => console.log(`CL mock server listening on ${url}`),
    statePath,
    snapshot,
    restore,
  });
}
