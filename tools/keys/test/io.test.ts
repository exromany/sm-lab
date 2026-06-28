import { describe, expect, it } from 'vitest';
import { makeDepositKeys } from '../src/keys';
import { toDepositDataJson } from '../src/io';

const MNEMONIC =
  'impact exit example acquire drastic cement usage float mesh source private bulb twenty guitar neglect';

describe('toDepositDataJson', () => {
  it('emits an array with eth-staking-smith fields and NO 0x prefixes', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    const json = JSON.parse(toDepositDataJson(keys)) as Array<Record<string, unknown>>;
    expect(json).toHaveLength(2);
    const first = json[0]!;
    expect(first.pubkey).toMatch(/^[0-9a-f]{96}$/); // 48 bytes, no 0x
    expect(first.signature).toMatch(/^[0-9a-f]{192}$/);
    expect(first.withdrawal_credentials).toMatch(/^[0-9a-f]{64}$/);
    expect(first.amount).toBe(32_000_000_000);
    expect(first.network_name).toBe('hoodi');
    expect(first.fork_version).toBe('10000910'); // no 0x
    expect(first.deposit_cli_version).toBeTypeOf('string');
  });
});
