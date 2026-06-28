import { writeFileSync } from 'node:fs';
import type { DepositKey } from './keys';

const strip = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex);

/**
 * Serialize keys to the eth-staking-smith / staking-deposit-cli JSON shape: a JSON array
 * with hex fields rendered WITHOUT a 0x prefix. The CSM SDK parser normalizes both forms;
 * matching the binary's exact shape keeps fixtures / diffs clean.
 */
export function toDepositDataJson(keys: DepositKey[]): string {
  const out = keys.map((k) => ({
    pubkey: strip(k.pubkey),
    withdrawal_credentials: strip(k.withdrawal_credentials),
    amount: k.amount,
    signature: strip(k.signature),
    deposit_message_root: strip(k.deposit_message_root),
    deposit_data_root: strip(k.deposit_data_root),
    fork_version: strip(k.fork_version),
    network_name: k.network_name,
    deposit_cli_version: k.deposit_cli_version,
  }));
  return JSON.stringify(out, null, 2);
}

export function writeDepositDataFile(path: string, keys: DepositKey[]): void {
  writeFileSync(path, toDepositDataJson(keys));
}
