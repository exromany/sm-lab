import { concat, keccak256, toHex } from 'viem';
import type { Hex } from '@sm-lab/receipts';

/**
 * A deterministic address from a seed + label (low 20 bytes of keccak256(seed ‖ label)).
 * The shared origin for recipe-generated operator addresses — same formula the cm
 * seedCm derivation has always used, so seeded outputs are stable across the move.
 */
export function deriveAddress(seed: Hex, label: string): Hex {
  const h = keccak256(concat([seed, toHex(label)]));
  return `0x${h.slice(-40)}` as Hex;
}
