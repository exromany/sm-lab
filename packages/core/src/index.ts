// Shared internals for csm-lab services. Bundled into each consumer (never published) —
// see packages/config/tsdown.base.ts `deps.alwaysBundle`.
export { startServer } from './server';
export type { StartServerOptions } from './server';

export { registerAdminRoutes, setShutdownHandler, readPackageVersion } from './admin';
export type { AdminRoutesOptions, BaseStatus } from './admin';

export { findRoot, resolveUrl, formatUptime, createStatusCommand, createStopCommand } from './cli';
export type { ClientTarget, BaseStatusResponse, StatusCommandOptions } from './cli';

// .gitkeep no longer needed now that src has real modules.
