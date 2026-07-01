import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { Hono } from 'hono';

/**
 * Persist `state` as pretty-printed JSON to `filePath`.
 * Creates parent directories if they don't exist.
 * The write is atomic: content is written to a temp file first, then renamed.
 */
export function saveStateToFile(filePath: string, state: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

/**
 * Load and parse JSON from `filePath`.
 * Returns `undefined` if the file does not exist.
 * Throws a descriptive error on malformed JSON.
 */
export function loadStateFromFile<T = unknown>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `loadStateFromFile: malformed JSON in "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface StateRoutesOptions {
  /** Return the current in-memory state snapshot. */
  snapshot: () => unknown;
  /** Restore in-memory state from a previously saved snapshot. */
  restore: (s: unknown) => void;
  /**
   * File path the routes operate on.
   * If not provided, both /admin/save and /admin/load respond 400.
   * The path is fixed at registration time — callers cannot override it via
   * query params (that would allow arbitrary file read/write).
   */
  defaultPath?: string;
}

/**
 * Register state persistence routes on an existing Hono app, mirroring the
 * `registerAdminRoutes` style:
 *
 *   POST /admin/save   — writes snapshot() to defaultPath; 400 if not configured
 *   POST /admin/load   — reads defaultPath, calls restore(); 400/404 on error
 *
 * The path is fixed to `defaultPath` — no `?path=` override is accepted, to
 * prevent arbitrary-file read/write via a client-supplied path.
 */
export function registerStateRoutes(app: Hono, opts: StateRoutesOptions): void {
  const { snapshot, restore, defaultPath } = opts;

  app.post('/admin/save', (c) => {
    if (!defaultPath)
      return c.json({ error: 'state path not configured; start serve with --state <file>' }, 400);
    saveStateToFile(defaultPath, snapshot());
    return c.json({ saved: defaultPath });
  });

  app.post('/admin/load', (c) => {
    if (!defaultPath)
      return c.json({ error: 'state path not configured; start serve with --state <file>' }, 400);
    if (!existsSync(defaultPath)) return c.json({ error: `state file not found: ${defaultPath}` }, 404);
    const s = loadStateFromFile(defaultPath);
    restore(s as unknown);
    return c.json({ loaded: defaultPath });
  });
}
