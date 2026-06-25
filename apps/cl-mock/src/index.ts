// Public library surface — lets consumers (e.g. SDK integration tests) boot the mock
// in-process instead of shelling out to the CLI. The `csm-cl-mock` binary lives in cli/index.ts.
// Shared server/admin plumbing (startServer, /admin/status + /admin/shutdown) comes from
// @csm-lab/core; this package owns the beacon + validator surface.
export { app, startServer } from './server/app';
export { store, ValidatorStore } from './server/store';
export { registerBeaconRoutes, buildValidator } from './server/beacon';
export { registerValidatorRoutes } from './server/admin';
export * from './types';
