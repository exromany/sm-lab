import { toHex } from 'viem';
import type { Hex } from '@csm-lab/receipts';

/** A node-operator id packed as the on-chain `bytes8(uint64)` (big-endian). */
export function nodeOperatorIdBytes(noId: bigint): Hex {
  return toHex(noId, { size: 8 });
}

/** A key count packed as the on-chain `bytes16(uint128)` (big-endian). */
export function keyCountBytes(count: bigint): Hex {
  return toHex(count, { size: 16 });
}
