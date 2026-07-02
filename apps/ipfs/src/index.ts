// Public library surface — lets consumers (e.g. SDK integration tests) boot the mock
// in-process instead of shelling out to the CLI, and inject a stub upstream gateway.
// The `sm-ipfs` binary lives in cli/index.ts.
export { app, createApp, startServer } from './server/app';
export type { AppOptions, AppHandle, ServeOptions } from './server/app';
export { store, PinStore } from './server/store';
export { computeCid, jsonToBytes, isLikelyCid } from './server/cid';
export { createUpstreamFetcher } from './server/upstream';
export type { UpstreamFetcher, UpstreamResult } from './server/upstream';
export { registerPinningRoutes } from './server/pinning';
export { registerGatewayRoutes } from './server/gateway';
export type { GatewayOptions } from './server/gateway';
// /admin/status + /admin/shutdown are provided by @sm-lab/core's registerAdminRoutes (not re-exported here).
export * from './types';
