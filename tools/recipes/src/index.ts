export { makeClient } from './client';
export type { RecipeClient } from './client';

export { connect, contract, resolveGate } from './context';
export type {
  Ctx,
  ConnectOptions,
  ResolvedAddresses,
  GateSelector,
  CsmGateSelector,
  CmGateSelector,
} from './context';

export { actAs, roleMember } from './act-as';
export { randomKeys } from './keys';
