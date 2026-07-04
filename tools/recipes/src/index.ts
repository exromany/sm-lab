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
export { warpBy, warpTo, snapshot, revert, topUpAccount } from './recipes/chain';
export { setTargetLimit } from './recipes/target-limit';
export type { SetTargetLimitOptions, SetTargetLimitResult } from './recipes/target-limit';

export { DEFAULT_ADMIN_ROLE, SET_TREE_ROLE, RESUME_ROLE, PAUSE_ROLE } from './roles';

export {
  proposeManager,
  confirmManager,
  proposeReward,
  confirmReward,
} from './recipes/address-changes';

export { nodeOperatorIdBytes, keyCountBytes } from './encode';
export { unvet, exit, removeKey } from './recipes/vetting';
export { deposit } from './recipes/deposit';
export { increaseAllocatedBalance, topUpActiveKeys } from './recipes/topup';

export { slash, withdraw, activateKeys, reportBalance } from './recipes/validators';
export type { WithdrawnValidatorInfo } from './recipes/validators';

export { REPORT_GENERAL_DELAYED_PENALTY_ROLE, SETTLE_GENERAL_DELAYED_PENALTY_ROLE } from './roles';
export {
  reportPenalty,
  cancelPenalty,
  settlePenalty,
  compensatePenalty,
} from './recipes/penalties';

export { addBond, createBondDebt } from './recipes/bond';

export { setGateAddrs } from './recipes/set-gate';
export type { SetGateAddrsOptions, SetGateAddrsResult } from './recipes/set-gate';

export { makeRewards, submitRewards } from './recipes/rewards';
export type { RewardsReport, MakeRewardsOptions, SubmitRewardsResult } from './recipes/rewards';

export { clActivate } from './recipes/cl-activate';
export type { ClActivateResult } from './recipes/cl-activate';
export {
  getPubkey,
  getKeyBalance,
  getCurveInfo,
  bondInfo,
  operatorKeys,
  keyBalances,
  operatorsCount,
  getLastOperator,
  getGateTree,
} from './recipes/reads';
export type { BondCurveInfo, BondCurveInterval, BondInfo, GateTree } from './recipes/reads';
export { setClValidator } from './cl-mock';
export type { SetValidatorInput } from './cl-mock';

export { pause, resume } from './recipes/pause';
export type { PauseResult } from './recipes/pause';

export { exitRequest } from './recipes/exit-request';
export type { ExitRequestOptions, ExitRequestResult } from './recipes/exit-request';
