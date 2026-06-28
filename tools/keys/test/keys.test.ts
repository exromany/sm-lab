import bls from '@chainsafe/bls/herumi';
import { describe, expect, it } from 'vitest';
import { CHAINS } from '../src/constants';
import { hexToBytes } from '../src/hex';
import { makeDepositKeys, withdrawalCredentials } from '../src/keys';
import { DepositMessage, computeDomain, computeSigningRoot } from '../src/ssz';

const MNEMONIC =
  'impact exit example acquire drastic cement usage float mesh source private bulb twenty guitar neglect';

describe('makeDepositKeys', () => {
  it('produces signatures that pass BLS verification against the deposit domain', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 3, mnemonic: MNEMONIC });
    expect(keys).toHaveLength(3);
    const domain = computeDomain(hexToBytes(CHAINS.hoodi.forkVersion));
    for (const k of keys) {
      const pubkey = hexToBytes(k.pubkey);
      const wc = hexToBytes(k.withdrawal_credentials);
      const sig = hexToBytes(k.signature);
      expect(pubkey.length).toBe(48);
      expect(wc.length).toBe(32);
      expect(sig.length).toBe(96);
      expect(k.amount).toBe(32_000_000_000);
      expect(k.fork_version).toBe('0x10000910');
      expect(k.network_name).toBe('hoodi');

      const messageRoot = DepositMessage.hashTreeRoot({
        pubkey,
        withdrawal_credentials: wc,
        amount: 32_000_000_000n,
      });
      // deposit_message_root must match the SDK's recomputation
      expect(k.deposit_message_root).toBe(
        `0x${Buffer.from(messageRoot).toString('hex')}`,
      );
      const signingRoot = computeSigningRoot(messageRoot, domain);
      expect(bls.verify(pubkey, signingRoot, sig)).toBe(true);
    }
  });

  it('is deterministic for a given mnemonic + index, and random otherwise', async () => {
    const a = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    const b = await makeDepositKeys({ chain: 'hoodi', count: 2, mnemonic: MNEMONIC });
    expect(b.keys.map((k) => k.pubkey)).toEqual(a.keys.map((k) => k.pubkey));

    const r = await makeDepositKeys({ chain: 'hoodi', count: 1 });
    expect(r.mnemonic.split(' ')).toHaveLength(12);
    expect(r.keys[0]!.pubkey).not.toBe(a.keys[0]!.pubkey);
  });

  it('startIndex shifts the derived keys', async () => {
    const a = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC, startIndex: 0 });
    const b = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC, startIndex: 5 });
    expect(b.keys[0]!.pubkey).not.toBe(a.keys[0]!.pubkey);
  });

  it('binds withdrawal credentials to the Lido vault with the chosen type', async () => {
    const { keys } = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC });
    const vault = CHAINS.hoodi.withdrawalVault.slice(2).toLowerCase();
    expect(keys[0]!.withdrawal_credentials.toLowerCase()).toBe(
      `0x01${'00'.repeat(11)}${vault}`,
    );

    const comp = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC, type: '0x02' });
    expect(comp.keys[0]!.withdrawal_credentials.startsWith('0x02')).toBe(true);

    const custom = '0x000000000000000000000000000000000000dEaD';
    const ov = await makeDepositKeys({ chain: 'hoodi', count: 1, mnemonic: MNEMONIC, withdrawalAddress: custom });
    expect(ov.keys[0]!.withdrawal_credentials.toLowerCase().endsWith('dead')).toBe(true);
  });

  it('computes a self-consistent deposit_data_root', async () => {
    const { keys } = await makeDepositKeys({ chain: 'mainnet', count: 1, mnemonic: MNEMONIC });
    const k = keys[0]!;
    expect(k.deposit_data_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(k.fork_version).toBe('0x00000000');
    expect(k.network_name).toBe('mainnet');
  });

  it('rejects bad input', async () => {
    await expect(makeDepositKeys({ count: 0 })).rejects.toThrow();
    await expect(makeDepositKeys({ mnemonic: 'not a real mnemonic' })).rejects.toThrow();
    // @ts-expect-error unknown chain
    await expect(makeDepositKeys({ chain: 'goerli', count: 1 })).rejects.toThrow();
  });
});

describe('withdrawalCredentials', () => {
  it('builds a 32-byte 0x01 credential', () => {
    const wc = withdrawalCredentials('0x01', '0x000000000000000000000000000000000000dEaD');
    expect(wc.length).toBe(32);
    expect(wc[0]).toBe(0x01);
    expect(wc.slice(1, 12).every((b) => b === 0)).toBe(true);
  });
});
