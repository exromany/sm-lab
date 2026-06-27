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

export { addKeys } from './recipes/add-keys';
export type { AddKeysOptions, AddKeysResult } from './recipes/add-keys';
export { operatorInfo } from './recipes/operator-info';
export type { OperatorInfo } from './recipes/operator-info';
export { warpBy, snapshot, revert } from './recipes/chain';

export { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE, RESUME_ROLE } from './roles';

export {
  proposeManager,
  confirmManager,
  proposeReward,
  confirmReward,
} from './recipes/address-changes';

export { nodeOperatorIdBytes, keyCountBytes } from './encode';
export { unvet, exit } from './recipes/vetting';
export { deposit } from './recipes/deposit';

export { slash, withdraw } from './recipes/validators';
export type { WithdrawnValidatorInfo } from './recipes/validators';

export { REPORT_GENERAL_DELAYED_PENALTY_ROLE, SETTLE_GENERAL_DELAYED_PENALTY_ROLE } from './roles';
export {
  reportPenalty,
  cancelPenalty,
  settlePenalty,
  compensatePenalty,
} from './recipes/penalties';

export { addBond, createBondDebt } from './recipes/bond';
