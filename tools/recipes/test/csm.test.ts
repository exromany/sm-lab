import { buildIcsTree } from '@sm-lab/merkle';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setGateAddrs } from '../src/csm/index';
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

  it('builds the ICS tree and sets it on VettedGate, impersonating the admin', async () => {
    const ADMIN = A(0xd0);
    const GATE = A(0x0d); // VettedGate (ics)
    const addrs = [A(0x11), A(0x12), A(0x13)];

    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: ADMIN } });
    const ctx = fakeCtx('csm', client, { VettedGate: GATE });

    const res = await setGateAddrs(ctx, { addresses: addrs, cid: 'test-cid' });

    const tree = buildIcsTree(addrs);
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

  it('throws when no cid is provided and IPFS is not configured', async () => {
    // No IPFS_API_URL / Pinata creds in the hermetic env → pin returns nothing.
    const ctx = fakeCtx('csm', makeFakeClient({ reads: { getRoleMember: A(0xd0) } }).client, {
      VettedGate: A(0x0d),
    });
    await expect(setGateAddrs(ctx, { addresses: [A(0x11)] })).rejects.toThrow(/IPFS|cid/i);
  });
});
