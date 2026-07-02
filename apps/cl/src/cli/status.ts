import { createStatusCommand, type BaseStatusResponse } from '@sm-lab/core';
import { DEFAULT_PORT } from '../types';

interface ClStatus extends BaseStatusResponse {
  validators: { total: number; byStatus: Record<string, number> };
}

export const statusCommand = createStatusCommand<ClStatus>({
  envVar: 'CL_MOCK_URL',
  defaultPort: DEFAULT_PORT,
  description:
    `GET /admin/status on the target CL mock (root --url / CL_MOCK_URL / ` +
    `127.0.0.1:${DEFAULT_PORT}); prints version, uptime and validator counts by status; ` +
    `exits 1 with "Error: <url> offline (...)" if unreachable`,
  render: (data) => {
    console.log(`Validators: ${data.validators.total}`);
    const entries = Object.entries(data.validators.byStatus);
    for (const [status, count] of entries.toSorted()) {
      console.log(`  ${status.padEnd(30)} ${count}`);
    }
  },
});
