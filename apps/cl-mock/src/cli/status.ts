import { createStatusCommand, type BaseStatusResponse } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

interface ClStatus extends BaseStatusResponse {
  validators: { total: number; byStatus: Record<string, number> };
}

export const statusCommand = createStatusCommand<ClStatus>({
  envVar: 'CL_MOCK_URL',
  defaultPort: DEFAULT_PORT,
  render: (data) => {
    console.log(`Validators: ${data.validators.total}`);
    const entries = Object.entries(data.validators.byStatus);
    for (const [status, count] of entries.toSorted()) {
      console.log(`  ${status.padEnd(30)} ${count}`);
    }
  },
});
