import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';

// Process start, captured once at module load (bundled into each consumer, so this is
// effectively the consumer process's start time).
const START_TIME = Date.now();

let shutdownHandler: (() => void) | null = null;

/** Register the graceful-shutdown closure that `POST /admin/shutdown` invokes. Called by startServer. */
export function setShutdownHandler(fn: () => void): void {
  shutdownHandler = fn;
}

/**
 * Read the consuming package's version from its package.json at runtime.
 *
 * Pass `import.meta.url` from the CONSUMER module. core is bundled into each consumer, so
 * after the build this code runs from the consumer's `dist/` and package.json sits one
 * level up (`../package.json`). Never throws — returns 'unknown' on any failure.
 */
export function readPackageVersion(metaUrl: string): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', metaUrl), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface BaseStatus {
  ok: true;
  version: string;
  startedAt: string;
  uptimeSeconds: number;
}

export interface AdminRoutesOptions {
  /** Server version, typically `readPackageVersion(import.meta.url)`. */
  version: string;
  /** App-specific fields merged into the `/admin/status` payload (e.g. validator/pin counts). */
  getStatus?: () => Record<string, unknown>;
}

/**
 * Register the admin surface shared by every sm-lab service:
 *   GET  /admin/status   → { ok, version, startedAt, uptimeSeconds, ...getStatus() }
 *   POST /admin/shutdown → graceful shutdown (deferred 50ms so the response flushes first)
 */
export function registerAdminRoutes(app: Hono, opts: AdminRoutesOptions): void {
  app.get('/admin/status', (c) => {
    const base: BaseStatus = {
      ok: true,
      version: opts.version,
      startedAt: new Date(START_TIME).toISOString(),
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    };
    return c.json({ ...base, ...opts.getStatus?.() });
  });

  app.post('/admin/shutdown', (c) => {
    if (shutdownHandler) setTimeout(shutdownHandler, 50);
    return c.json({ message: 'shutting down' });
  });
}
