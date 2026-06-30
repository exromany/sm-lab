import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  registerAdminRoutes,
  readPackageVersion,
  startServer as coreStartServer,
} from '@csm-lab/core';
import { PinStore, store as defaultStore } from './store';
import { registerPinningRoutes } from './pinning';
import { registerGatewayRoutes } from './gateway';
import { createUpstreamFetcher, type UpstreamFetcher } from './upstream';
import { DEFAULT_GATEWAY, DEFAULT_HOST, DEFAULT_PORT } from '../types';

// Read once at module load (bundled → resolves to this package's dist/../package.json).
const VERSION = readPackageVersion(import.meta.url);

export interface AppOptions {
  /** Pin store. Defaults to a fresh in-memory store. Pass a persist-backed one to survive restarts. */
  store?: PinStore;
  /** Upstream IPFS gateway base URL (for the default fetcher + /admin/status). */
  gateway?: string;
  /** Override the upstream fetcher entirely — tests inject a stub here to avoid the network. */
  fetchUpstream?: UpstreamFetcher;
  /** Cache proxied content back into the store (default true). */
  cacheUpstream?: boolean;
}

export interface AppHandle {
  app: Hono;
  store: PinStore;
  gateway: string;
}

/**
 * Builds a fully-wired Hono app. Everything that touches the outside world (the store, the
 * upstream gateway) is injectable, so the same factory powers the CLI server AND hermetic
 * tests (stub `fetchUpstream`, get a fresh in-memory `store`).
 *
 * The shared `/admin/status` + `/admin/shutdown` come from `@csm-lab/core`; ipfs-mock
 * contributes the gateway + pin totals via `getStatus`.
 */
export function createApp(options: AppOptions = {}): AppHandle {
  const store = options.store ?? new PinStore();
  const gateway = options.gateway ?? process.env.IPFS_UPSTREAM_GATEWAY ?? DEFAULT_GATEWAY;
  const fetchUpstream = options.fetchUpstream ?? createUpstreamFetcher(gateway);

  const app = new Hono();
  // Permissive CORS: this mock backs browser consumers (csm-widget) cross-origin, so the
  // pinning API + /ipfs gateway must answer preflights and echo Access-Control-Allow-Origin.
  app.use('*', cors());
  registerPinningRoutes(app, store);
  registerGatewayRoutes(app, { store, fetchUpstream, cacheUpstream: options.cacheUpstream });
  registerAdminRoutes(app, {
    version: VERSION,
    getStatus: () => {
      const totalBytes = store.list().reduce((sum, p) => sum + p.size, 0);
      return { gateway, pins: { total: store.size, totalBytes } };
    },
  });

  return { app, store, gateway };
}

/** Default app instance backed by the singleton store — convenient for in-process embedding. */
export const { app } = createApp({ store: defaultStore });

export interface ServeOptions {
  port?: number;
  host?: string;
  gateway?: string;
  persist?: string;
}

/**
 * Boots the HTTP server (via core's startServer: graceful shutdown wired to SIGINT/SIGTERM
 * and POST /admin/shutdown). Builds its own app honoring --persist / --gateway.
 */
export function startServer(options: ServeOptions = {}): ReturnType<typeof coreStartServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const store = options.persist ? new PinStore(options.persist) : new PinStore();
  const { app: serverApp, gateway } = createApp({ store, gateway: options.gateway });

  return coreStartServer(serverApp, {
    port,
    host,
    onListen: (url) => {
      console.log(`IPFS mock listening on ${url}`);
      console.log(`  upstream gateway: ${gateway}`);
      if (options.persist) console.log(`  persisting pins to: ${options.persist}`);
    },
  });
}
