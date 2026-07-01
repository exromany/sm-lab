import { createStatusCommand, type BaseStatusResponse } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

interface IpfsStatus extends BaseStatusResponse {
  gateway: string;
  pins: { total: number; totalBytes: number };
}

export const statusCommand = createStatusCommand<IpfsStatus>({
  envVar: 'IPFS_MOCK_URL',
  defaultPort: DEFAULT_PORT,
  render: (data) => {
    console.log(`Gateway:    ${data.gateway}`);
    console.log(`Pins:       ${data.pins.total} (${formatBytes(data.pins.totalBytes)})`);
  },
});
