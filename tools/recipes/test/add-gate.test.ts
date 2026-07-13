import { buildAddressesTree } from '@sm-lab/merkle';
import { getAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addGateAddrs } from '../src/recipes/add-gate';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const dumpResponse = (addrs: string[]): Response =>
  new Response(JSON.stringify(buildAddressesTree(addrs).dump()), { status: 200 });

// Valid IPFS CIDs — a gate with a REAL allowlist carries one of these (isLikelyCid → true, fetched).
const CUR_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const FROM_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

const clearIpfsEnv = (): void => {
  delete process.env.IPFS_API_URL;
  delete process.env.IPFS_GATEWAY_URL;
  delete process.env.PINATA_JWT;
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_API_SECRET;
};

describe('addGateAddrs', () => {
  beforeEach(clearIpfsEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIpfsEnv();
  });

  it('reads the current tree from IPFS, unions the new address, and re-installs it (csm)', async () => {
    const ADMIN = A(0xd0);
    const GATE = A(0x0d); // IcsGate (ics default)
    const current = [A(0x11), A(0x12)];
    const fetchMock = vi.fn().mockResolvedValue(dumpResponse(current));
    vi.stubGlobal('fetch', fetchMock);

    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: ADMIN, treeCid: CUR_CID },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: GATE });

    const res = await addGateAddrs(ctx, { addresses: [A(0x13)], cid: 'new-cid' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://127.0.0.1:5001/ipfs/${CUR_CID}`);

    const union = [A(0x11), A(0x12), A(0x13)];
    expect(res.treeRoot).toBe(buildAddressesTree(union).root);
    expect(res.treeCid).toBe('new-cid');
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([getAddress(A(0x13))]);

    const set = (byMethod('writeContract') as any[]).find(
      (w) => w.functionName === 'setTreeParams',
    );
    expect(set.address).toBe(GATE);
    expect(set.args).toEqual([buildAddressesTree(union).root, 'new-cid']);
    expect(set.account).toBe(ADMIN);
  });

  it('is a no-op (no writes) when every new address is already whitelisted', async () => {
    const current = [A(0x11), A(0x12)];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dumpResponse(current)));
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: CUR_CID },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    const res = await addGateAddrs(ctx, { addresses: [A(0x11)], cid: 'ignored' });

    expect(res.changed).toBe(false);
    expect(res.added).toEqual([]);
    expect(res.treeCid).toBe(CUR_CID);
    expect(res.treeRoot).toBe(buildAddressesTree(current).root);
    expect(byMethod('writeContract')).toHaveLength(0); // no grantRole, no setTreeParams
  });

  it('treats a fresh gate (empty treeCid) as an empty set — no IPFS read; installs the new set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: '' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    const res = await addGateAddrs(ctx, { addresses: [A(0x11)], cid: 'new-cid' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([getAddress(A(0x11))]);
    const set = (byMethod('writeContract') as any[]).find(
      (w) => w.functionName === 'setTreeParams',
    );
    expect(set.args).toEqual([buildAddressesTree([A(0x11)]).root, 'new-cid']);
  });

  it('--from-cid bypasses the on-chain treeCid() read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(dumpResponse([A(0x11)]));
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({ reads: { getRoleMember: A(0xd0) } });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    await addGateAddrs(ctx, { addresses: [A(0x12)], fromCid: FROM_CID, cid: 'new-cid' });

    const readNames = (byMethod('readContract') as any[]).map((r) => r.functionName);
    expect(readNames).not.toContain('treeCid');
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://127.0.0.1:5001/ipfs/${FROM_CID}`);
  });

  it('rejects an empty addresses list with an actionable error (no reads, no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: 'cur-cid' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    await expect(addGateAddrs(ctx, { addresses: [] })).rejects.toThrow(/at least one address/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(byMethod('readContract')).toHaveLength(0);
  });

  it('treats an empty-gate placeholder treeCid (non-CID) as empty — no fetch; installs the new set', async () => {
    // A gate with no allowlist carries a placeholder treeCid ("someCid"), not a real pinned CID.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client, byMethod } = makeFakeClient({
      reads: { getRoleMember: A(0xd0), treeCid: 'someCid' },
    });
    const ctx = fakeCtx('csm', client, { IcsGate: A(0x0d) });

    const res = await addGateAddrs(ctx, { addresses: [A(0x11)], cid: 'new-cid' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([getAddress(A(0x11))]);
    const set = (byMethod('writeContract') as any[]).find(
      (w) => w.functionName === 'setTreeParams',
    );
    expect(set.args).toEqual([buildAddressesTree([A(0x11)]).root, 'new-cid']);
  });
});
