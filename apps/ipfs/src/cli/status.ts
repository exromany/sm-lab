import { createStatusCommand, type BaseStatusResponse } from '@sm-lab/core';
import { DEFAULT_PORT, type GatewayHealthEntry } from '../types';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

/** ✓ reached & serving · — never tried · ✗ attempted but never reached (broken). */
function verdict(g: GatewayHealthEntry): string {
  if (!g.healthy) return '✗';
  return g.attempts === 0 ? '—' : '✓';
}

/** One aligned health line, e.g. `✗ https://ipfs.io  hits=0 miss=0 timeout=3 unreachable=0  (all timed out)`. */
function gatewayLine(g: GatewayHealthEntry, pad: number): string {
  const counts = `hits=${g.hits} miss=${g.misses} timeout=${g.timeouts} unreachable=${g.unreachable}`;
  const note = g.note ? `  (${g.note})` : '';
  return `${verdict(g)} ${g.gateway.padEnd(pad)}  ${counts}${note}`;
}

interface IpfsStatus extends BaseStatusResponse {
  gateway: string;
  /** Per-gateway health chain; present only when the server's fetcher exposes a snapshot. */
  gateways?: GatewayHealthEntry[];
  pins: { total: number; totalBytes: number };
}

export const statusCommand = createStatusCommand<IpfsStatus>({
  envVar: 'IPFS_MOCK_URL',
  defaultPort: DEFAULT_PORT,
  description:
    `GET /admin/status on the target IPFS mock (root --url / IPFS_MOCK_URL / ` +
    `127.0.0.1:${DEFAULT_PORT}); prints version, uptime, pin count/bytes and per-gateway ` +
    `upstream health (✓/✗/—); exits 1 with "Error: <url> offline (...)" if unreachable`,
  render: (data) => {
    if (data.gateways?.length) {
      const pad = Math.max(...data.gateways.map((g) => g.gateway.length));
      console.log('Gateways:');
      for (const g of data.gateways) console.log(`  ${gatewayLine(g, pad)}`);
    } else {
      console.log(`Gateway:    ${data.gateway}`);
    }
    console.log(`Pins:       ${data.pins.total} (${formatBytes(data.pins.totalBytes)})`);
  },
});
