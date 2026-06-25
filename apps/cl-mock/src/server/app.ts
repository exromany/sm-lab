import { Hono } from 'hono';
import {
  registerAdminRoutes,
  readPackageVersion,
  startServer as coreStartServer,
} from '@csm-lab/core';
import { registerBeaconRoutes } from './beacon';
import { registerValidatorRoutes } from './admin';
import { store } from './store';

const app = new Hono();

registerBeaconRoutes(app);
registerValidatorRoutes(app);
registerAdminRoutes(app, {
  version: readPackageVersion(import.meta.url),
  getStatus: () => {
    const byStatus: Record<string, number> = {};
    for (const { entry } of store.list()) {
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
    }
    return { validators: { total: store.size, byStatus } };
  },
});

export { app };

/** Boot the CL mock server. Thin wrapper over core's startServer with a cl-mock log line. */
export function startServer(port: number, host: string): ReturnType<typeof coreStartServer> {
  return coreStartServer(app, {
    port,
    host,
    onListen: (url) => console.log(`CL mock server listening on ${url}`),
  });
}
