import { createStopCommand } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

export const stopCommand = createStopCommand({
  envVar: 'IPFS_MOCK_URL',
  defaultPort: DEFAULT_PORT,
  description:
    `Gracefully shut down the target IPFS mock via POST /admin/shutdown (root --url / ` +
    `IPFS_MOCK_URL / 127.0.0.1:${DEFAULT_PORT}); exits 1 if unreachable`,
});
