// Shared internals for sm-lab services. Bundled into each consumer (never published) —
// see packages/config/tsdown.base.ts `deps.alwaysBundle`.
export { startServer } from './server';
export type { StartServerOptions } from './server';

export { registerAdminRoutes, setShutdownHandler, readPackageVersion } from './admin';
export type { AdminRoutesOptions, BaseStatus } from './admin';

export { findRoot, resolveUrl, formatUptime, createStatusCommand, createStopCommand } from './cli';
export type { ClientTarget, BaseStatusResponse, StatusCommandOptions } from './cli';

export { saveStateToFile, loadStateFromFile, registerStateRoutes } from './state';
export type { StateRoutesOptions } from './state';
