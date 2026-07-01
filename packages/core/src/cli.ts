import { Command } from 'commander';

/** Climb to the root program so commands at any nesting depth can read root-level options (e.g. --url). */
export function findRoot(cmd: Command): Command {
  let c = cmd;
  while (c.parent) c = c.parent;
  return c;
}

export interface ClientTarget {
  /** Env var holding the server URL (e.g. CL_MOCK_URL). */
  envVar: string;
  /** Default port when neither --url nor the env var is set. */
  defaultPort: number;
}

/** Resolve the target server URL: root `--url` option → env var → `http://127.0.0.1:<defaultPort>`. */
export function resolveUrl(cmd: Command, target: ClientTarget): string {
  const opts = findRoot(cmd).opts() as { url?: string };
  return opts.url ?? process.env[target.envVar] ?? `http://127.0.0.1:${target.defaultPort}`;
}

/** Format seconds as a compact `1h 2m 3s` string (omits leading zero units). */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m || h) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export interface BaseStatusResponse {
  ok: boolean;
  version: string;
  startedAt: string;
  uptimeSeconds: number;
}

export interface StatusCommandOptions<T extends BaseStatusResponse> extends ClientTarget {
  /** Print app-specific lines after the shared header (URL/Status/Version/Started/Uptime). */
  render?: (data: T, url: string) => void;
}

/**
 * Build a `status` command: GET /admin/status, print the shared header, then app-specific
 * lines via `render`. `--json` dumps the raw payload. On connect failure prints
 * `<url>  offline (<reason>)` and exits 1 (status is the "is it up?" question, not an error).
 */
export function createStatusCommand<T extends BaseStatusResponse>(
  opts: StatusCommandOptions<T>,
): Command {
  return new Command('status')
    .description('Show status of a running server')
    .option('--json', 'output raw JSON')
    .action(async (cmdOpts: { json?: boolean }, cmd: Command) => {
      const url = resolveUrl(cmd, opts);
      let res: Response;
      try {
        res = await fetch(`${url}/admin/status`);
      } catch (err) {
        console.error('Error:', `${url} offline (${err instanceof Error ? err.message : String(err)})`);
        process.exit(1);
      }
      if (!res.ok) {
        console.error(`Unexpected response: ${res.status}`);
        process.exit(1);
      }
      const data = (await res.json()) as T;
      if (cmdOpts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(`URL:        ${url}`);
      console.log(`Status:     ok`);
      console.log(`Version:    ${data.version}`);
      console.log(`Started:    ${data.startedAt}`);
      console.log(`Uptime:     ${formatUptime(data.uptimeSeconds)}`);
      opts.render?.(data, url);
    });
}

/** Build a `stop` command: POST /admin/shutdown to the resolved URL. */
export function createStopCommand(target: ClientTarget): Command {
  return new Command('stop')
    .description('Stop a running server')
    .action(async (_cmdOpts: unknown, cmd: Command) => {
      const url = resolveUrl(cmd, target);
      let res: Response;
      try {
        res = await fetch(`${url}/admin/shutdown`, { method: 'POST' });
      } catch (err) {
        console.error(
          `Failed to connect to ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      if (res.ok) {
        console.log('Server shutting down');
      } else {
        console.error(`Unexpected response: ${res.status}`);
        process.exit(1);
      }
    });
}
