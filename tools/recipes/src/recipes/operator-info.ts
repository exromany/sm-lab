import type { Hex } from '@sm-lab/receipts';
import { contract, type Ctx } from '../context';

/** Decoded NodeOperator (abitype: uint32/uint8 → number, address → Hex, bool → boolean). */
export interface OperatorInfo {
  totalAddedKeys: number;
  totalWithdrawnKeys: number;
  totalDepositedKeys: number;
  totalVettedKeys: number;
  stuckValidatorsCount: number;
  depositableValidatorsCount: number;
  targetLimit: number;
  targetLimitMode: number;
  totalExitedKeys: number;
  enqueuedCount: number;
  managerAddress: Hex;
  proposedManagerAddress: Hex;
  rewardAddress: Hex;
  proposedRewardAddress: Hex;
  extendedManagerPermissions: boolean;
  usedPriorityQueue: boolean;
}

/** Typed read of a node operator's on-chain record. (Port of `NodeOperators.operatorInfo`.) */
export async function operatorInfo(ctx: Ctx, opts: { noId: bigint }): Promise<OperatorInfo> {
  const m = contract(ctx, 'module');
  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  return op as OperatorInfo;
}
