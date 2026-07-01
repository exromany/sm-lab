import { createStopCommand } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

export const stopCommand = createStopCommand({
  envVar: 'IPFS_MOCK_URL',
  defaultPort: DEFAULT_PORT,
});
