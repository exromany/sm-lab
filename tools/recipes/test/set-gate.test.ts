import { buildAddressesTree } from '@sm-lab/merkle';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setGateAddrs } from '../src/recipes/set-gate';
import { SET_TREE_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

describe('setGateAddrs', () => {
  beforeEach(() => {
    delete process.env.IPFS_API_URL;
    delete process.env.PINATA_JWT;
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_API_SECRET;
  });

  afterEach(() => {
    delete process.env.IPFS_API_URL;
    delete process.env.PINATA_JWT;
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_API_SECRET;
  });

  it('builds the addresses tree and sets it on the csm VettedGate, impersonating the admin', async () => {
    const ADMIN = A(0xd0);
    const GATE = A(0x0d); // VettedGate (ics)
    const addrs = [A(0x11), A(0x12), A(0x13)];

    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', client, { VettedGate: GATE });

    const res = await setGateAddrs(ctx, { addresses: addrs, cid: 'test-cid' });

    const tree = buildAddressesTree(addrs);
    expect(res.treeRoot).toBe(tree.root);
    expect(res.treeCid).toBe('test-cid');

    const writes = byMethod('writeContract') as any[];
    const grant = writes.find((w) => w.functionName === 'grantRole');
    expect(grant.args[0]).toBe(SET_TREE_ROLE);
    expect(grant.args[1]).toBe(ADMIN);

    const set = writes.find((w) => w.functionName === 'setTreeParams');
    expect(set.address).toBe(GATE);
    expect(set.args).toEqual([tree.root, 'test-cid']);
    expect(set.account).toBe(ADMIN);

    expect(byMethod('impersonateAccount')[0]).toEqual({ address: ADMIN });
  });

  it('defaults to the cm gate (po → CuratedGates[0]) and sets the tree there', async () => {
    const ADMIN = A(0xd0);
    const addrs = [A(0x11), A(0x12)];

    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: ADMIN } });
    // cmBook seeds CuratedGates = [A(0x30), A(0x31), …]; 'po' (the default) → CuratedGates[0].
    const ctx = fakeCtx('cm', client);

    const res = await setGateAddrs(ctx, { addresses: addrs, cid: 'test-cid' });

    const tree = buildAddressesTree(addrs);
    expect(res.treeRoot).toBe(tree.root);

    const writes = byMethod('writeContract') as any[];
    const set = writes.find((w) => w.functionName === 'setTreeParams');
    expect(set.address).toBe(A(0x30)); // po → CuratedGates[0]
    expect(set.args).toEqual([tree.root, 'test-cid']);
    expect(set.account).toBe(ADMIN);
  });

  it('honours an explicit cm gate selector (pto → CuratedGates[1])', async () => {
    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: A(0xd0) } });
    const ctx = fakeCtx('cm', client);

    await setGateAddrs(ctx, { addresses: [A(0x11)], selector: 'pto', cid: 'test-cid' });

    const set = (byMethod('writeContract') as any[]).find(
      (w) => w.functionName === 'setTreeParams',
    );
    expect(set.address).toBe(A(0x31)); // pto → CuratedGates[1]
  });

  it('throws when no cid is provided and IPFS is not configured', async () => {
    // With the local-first IPFS default, shouldAttemptPin() is true unless IPFS_API_URL points
    // at real Pinata with no credentials. Set that edge case to trigger the guard throw.
    process.env.IPFS_API_URL = 'https://api.pinata.cloud';
    const ctx = fakeCtx('csm', makeFakeClient({ reads: { getRoleMember: A(0xd0) } }).client, {
      VettedGate: A(0x0d),
    });
    await expect(setGateAddrs(ctx, { addresses: [A(0x11)] })).rejects.toThrow(/IPFS|cid/i);
  });
});
