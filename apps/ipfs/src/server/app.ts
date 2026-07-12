import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  registerAdminRoutes,
  registerStateRoutes,
  readPackageVersion,
  startServer as coreStartServer,
} from '@sm-lab/core';
import { PinStore, store as defaultStore, snapshotStore, restoreStore } from './store';
import { registerPinningRoutes } from './pinning';
import { registerGatewayRoutes } from './gateway';
import { createUpstreamFetcher, type UpstreamFetcher } from './upstream';
import { DEFAULT_GATEWAYS, DEFAULT_HOST, DEFAULT_PORT } from '../types';

// Read once at module load (bundled → resolves to this package's dist/../package.json).
const VERSION = readPackageVersion(import.meta.url);

export interface AppOptions {
  /** Pin store. Defaults to a fresh in-memory store. Pass a persist-backed one to survive restarts. */
  store?: PinStore;
  /**
   * Upstream IPFS gateway(s) for the default fetcher + /admin/status. One base URL, an array of
   * them, or a comma-separated string — multiple form a fallback chain (first 2xx wins).
   * Defaults to {@link DEFAULT_GATEWAYS}.
   */
  gateway?: string | string[];
  /** Override the upstream fetcher entirely — tests inject a stub here to avoid the network. */
  fetchUpstream?: UpstreamFetcher;
  /** Cache proxied content back into the store (default true). */
  cacheUpstream?: boolean;
  /**
   * Default file path for POST /admin/save and POST /admin/load.
   * When set, state routes are registered (always). The path is also used as the default
   * ?path= target when the request omits it.
   */
  statePath?: string;
}

export interface AppHandle {
  app: Hono;
  store: PinStore;
  /** The resolved upstream fallback chain (in try order). */
  gateways: string[];
}

/**
 * Resolves the upstream gateway chain: explicit option → `IPFS_UPSTREAM_GATEWAY` env →
 * {@link DEFAULT_GATEWAYS}. A string (option or env) is split on commas so a single flag/var can
 * name several. Empty entries are dropped; an all-empty result falls back to the defaults.
 */
function resolveGateways(option?: string | readonly string[]): string[] {
  const raw = option ?? process.env.IPFS_UPSTREAM_GATEWAY ?? DEFAULT_GATEWAYS;
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((g) => g.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_GATEWAYS];
}

/**
 * Builds a fully-wired Hono app. Everything that touches the outside world (the store, the
 * upstream gateway) is injectable, so the same factory powers the CLI server AND hermetic
 * tests (stub `fetchUpstream`, get a fresh in-memory `store`).
 *
 * The shared `/admin/status` + `/admin/shutdown` come from `@sm-lab/core`; ipfs-mock
 * contributes the gateway + pin totals via `getStatus`.
 */
export function createApp(options: AppOptions = {}): AppHandle {
  const store = options.store ?? new PinStore();
  const gateways = resolveGateways(options.gateway);
  const fetchUpstream = options.fetchUpstream ?? createUpstreamFetcher(gateways);

  const snapshot = () => snapshotStore(store);
  const restore = (s: unknown) => restoreStore(store, s);

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
      // Reported as a display string; the chain is comma-joined in try order.
      return { gateway: gateways.join(', '), pins: { total: store.size, totalBytes } };
    },
  });
  registerStateRoutes(app, { snapshot, restore, defaultPath: options.statePath });

  return { app, store, gateways };
}

/** Default app instance backed by the singleton store — convenient for in-process embedding. */
export const { app } = createApp({ store: defaultStore });

export interface ServeOptions {
  port?: number;
  host?: string;
  gateway?: string;
  persist?: string;
  /** Path to a JSON state file for boot-restore + shutdown-save. */
  statePath?: string;
}

/**
 * Boots the HTTP server (via core's startServer: graceful shutdown wired to SIGINT/SIGTERM
 * and POST /admin/shutdown). Builds its own app honoring --persist / --gateway / --state.
 */
export function startServer(options: ServeOptions = {}): ReturnType<typeof coreStartServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const store = options.persist ? new PinStore(options.persist) : new PinStore();
  const { app: serverApp, gateways } = createApp({
    store,
    gateway: options.gateway,
    statePath: options.statePath,
  });

  const snapshot = () => snapshotStore(store);
  const restore = (s: unknown) => restoreStore(store, s);

  return coreStartServer(serverApp, {
    port,
    host,
    statePath: options.statePath,
    snapshot,
    restore,
    onListen: (url) => {
      console.log(`IPFS mock listening on ${url}`);
      console.log(`  upstream gateway${gateways.length > 1 ? 's' : ''}: ${gateways.join(', ')}`);
      if (options.persist) console.log(`  persisting pins to: ${options.persist}`);
      if (options.statePath) console.log(`  state file: ${options.statePath}`);
      console.log(`  fetch a CID: ${url}/ipfs/<cid>`);
    },
  });
}
