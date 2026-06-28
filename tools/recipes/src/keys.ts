import { concat, keccak256, toHex } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { randomSeed } from './random';

/**
 * Deterministic, well-formed validator keys. NOT the Solidity byte sequence — keys only
 * need to be unique and correctly sized (48-byte pubkey, 96-byte signature). A keccak
 * hash-chain expands the seed; pass a fixed `seed` for reproducible tests, omit it for
 * fresh randomness.
 */
export function randomKeys(
  count: number,
  seed?: Hex,
): { publicKeys: Hex[]; signatures: Hex[]; packedKeys: Hex; packedSignatures: Hex } {
  const root = seed ?? randomSeed();
  const publicKeys: Hex[] = [];
  const signatures: Hex[] = [];
  for (let i = 0; i < count; i++) {
    publicKeys.push(expand(root, `pk-${i}`, 48));
    signatures.push(expand(root, `sig-${i}`, 96));
  }
  return {
    publicKeys,
    signatures,
    packedKeys: count === 0 ? '0x' : concat(publicKeys),
    packedSignatures: count === 0 ? '0x' : concat(signatures),
  };
}

function expand(seed: Hex, label: string, nBytes: number): Hex {
  const chunks: Hex[] = [];
  let produced = 0;
  let counter = 0;
  while (produced < nBytes) {
    chunks.push(keccak256(concat([seed, toHex(label), toHex(counter, { size: 4 })])));
    produced += 32;
    counter++;
  }
  return `0x${concat(chunks).slice(2, 2 + nBytes * 2)}` as Hex;
}
