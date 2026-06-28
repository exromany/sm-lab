import { toHex } from 'viem';
import type { Hex } from '@csm-lab/receipts';

/**
 * A 32-byte cryptographically-random seed, hex-encoded. The shared origin for every recipe that
 * needs fresh-but-reproducible-on-demand randomness (key material, reward draws, operator
 * addresses) — pass a fixed seed for deterministic output, call this to mint a fresh one.
 */
export function randomSeed(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}
