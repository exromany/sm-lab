import { makeDepositKeys } from '@sm-lab/keys';
import { concat, keccak256, toBytes } from 'viem';
import type { Hex } from '@sm-lab/receipts';
import { randomSeed } from './random';

/**
 * Fixed BIP-39 mnemonic for deterministic test/recipe key derivation. NOT a production
 * key — exists only for hermetic reproducibility. The seed controls the startIndex,
 * which determines the EIP-2334 derivation path slice used.
 */
const RECIPE_MNEMONIC =
  'impact exit example acquire drastic cement usage float mesh source private bulb twenty guitar neglect';

/**
 * Deterministic real BLS validator keys derived from a fixed mnemonic at a seed-derived
 * startIndex. Produces genuine 48-byte G1 pubkeys + 96-byte G2 BLS signatures — NOT
 * keccak-expanded pseudo-keys. Pass a fixed `seed` for reproducible tests.
 *
 * The seed maps to a `startIndex` via `keccak256(seed) % 2^20` so different seeds yield
 * non-overlapping key ranges (1M range >> any realistic `count`).
 */
export async function randomKeys(
  count: number,
  seed?: Hex,
): Promise<{ publicKeys: Hex[]; signatures: Hex[]; packedKeys: Hex; packedSignatures: Hex }> {
  const root = seed ?? randomSeed();
  const startIndex = Number(BigInt(keccak256(toBytes(root))) % 2n ** 20n);

  const { keys } = await makeDepositKeys({
    mnemonic: RECIPE_MNEMONIC,
    count,
    startIndex,
    // NOTE: withdrawal_credentials + fork-version DO sign into the BLS signature (the sig covers
    // a DepositMessage hash under a domain derived from the fork version). But this path never
    // verifies it: CSModule.addValidatorKeysETH → SigningKeys.saveKeysSigs only checks length +
    // non-empty (no BLS verify), and the deposit recipe uses obtainDepositData (StakingRouter-
    // impersonated), not the beacon DepositContract. So the chosen chain is arbitrary-but-valid here.
    chain: 'hoodi',
  });

  const publicKeys = keys.map((k) => k.pubkey as Hex);
  const signatures = keys.map((k) => k.signature as Hex);

  return {
    publicKeys,
    signatures,
    packedKeys: count === 0 ? '0x' : (concat(publicKeys) as Hex),
    packedSignatures: count === 0 ? '0x' : (concat(signatures) as Hex),
  };
}
