import { buildAddressesTree } from '@sm-lab/merkle';
import { getAddress, parseEther, zeroAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAddress } from '../src/derive';
import { createCsmOperator } from '../src/recipes/create-operator';
import { RESUME_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const SEED = `0x${'01'.repeat(32)}` as const;
const PERM_GATE = A(0x0e); // csmBook().PermissionlessGate
const ICS_GATE = A(0x0d); // csmBook().IcsGate
const ACCOUNTING = A(0x02); // csmBook().Accounting
const ADMIN = A(0xd0);
const REQUEST = { functionName: 'addNodeOperatorETH', isCreateReq: true };
// Valid CID — a gate with a real allowlist carries one (isLikelyCid → true, fetched).
const CUR_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

const dumpResponse = (addrs: string[]): Response =>
  new Response(JSON.stringify(buildAddressesTree(addrs).dump()), { status: 200 });

const clearIpfsEnv = (): void => {
  delete process.env.IPFS_API_URL;
  delete process.env.IPFS_GATEWAY_URL;
  delete process.env.PINATA_JWT;
  delete process.env.PINATA_API_KEY;
  delete process.env.PINATA_API_SECRET;
};

describe('createCsmOperator — permissionless (no selector)', () => {
  it('creates via PermissionlessGate: CURVE_ID bond, no proof, zero-address defaults', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('2.4') },
      simulate: { result: 5n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED });

    expect(res.noId).toBe(5n);
    expect(res.address).toBe(getAddress(deriveAddress(SEED, 'csm-operator')));
    expect(res.publicKeys).toHaveLength(1);
    expect(res.bond).toBe(parseEther('2.4'));
    expect(res.treeCid).toBeUndefined();

    const reads = byMethod('readContract') as any[];
    expect(reads.find((r) => r.functionName === 'CURVE_ID').address).toBe(PERM_GATE);
    const bond = reads.find((r) => r.functionName === 'getBondAmountByKeysCount');
    expect(bond.address).toBe(ACCOUNTING);
    expect(bond.args).toEqual([1n, 0n]);

    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.address).toBe(PERM_GATE);
    expect(sim.functionName).toBe('addNodeOperatorETH');
    expect(sim.account).toBe(res.address);
    expect(sim.value).toBe(parseEther('2.4'));
    expect(sim.args).toHaveLength(5); // no proof param on the permissionless gate
    expect(sim.args[0]).toBe(1n);
    expect(sim.args[3]).toEqual({
      managerAddress: zeroAddress,
      rewardAddress: zeroAddress,
      extendedManagerPermissions: false,
    });
    expect(sim.args[4]).toBe(zeroAddress); // referrer

    expect((byMethod('writeContract') as any[]).some((w) => w.isCreateReq)).toBe(true);
    expect(byMethod('impersonateAccount')).toContainEqual({ address: res.address });
    expect(byMethod('stopImpersonatingAccount')).toContainEqual({ address: res.address });
  });

  it('honours keysCount/address/manager/reward/extendedManagerPermissions overrides', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('4.8') },
      simulate: { result: 6n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, {
      seed: SEED,
      keysCount: 2,
      address: A(0xc1),
      manager: A(0xc2),
      reward: A(0xc3),
      extendedManagerPermissions: true,
    });

    expect(res.address).toBe(getAddress(A(0xc1)));
    expect(res.publicKeys).toHaveLength(2);
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.args[0]).toBe(2n);
    expect(sim.args[3]).toEqual({
      managerAddress: A(0xc2),
      rewardAddress: A(0xc3),
      extendedManagerPermissions: true,
    });
    const bond = (byMethod('readContract') as any[]).find(
      (r) => r.functionName === 'getBondAmountByKeysCount',
    );
    expect(bond.args).toEqual([2n, 0n]);
  });

  it('tops the balance up past the actAs 100 ETH when the bond needs it', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { CURVE_ID: 0n, getBondAmountByKeysCount: parseEther('150') },
      simulate: { result: 7n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED });

    const balances = byMethod('setBalance') as any[];
    expect(balances).toHaveLength(2); // actAs's 100 ETH, then the bond top-up
    expect(balances[1]).toEqual({ address: res.address, value: parseEther('160') });
  });

  it('guards: cm ctx and keysCount < 1 are rejected', async () => {
    const cmCtx = fakeCtx('cm', makeFakeClient().client);
    await expect(createCsmOperator(cmCtx, {})).rejects.toThrow(/requires ctx\.module === "csm"/);
    const csmCtx = fakeCtx('csm', makeFakeClient().client);
    await expect(createCsmOperator(csmCtx, { keysCount: 0 })).rejects.toThrow(/keysCount/);
  });

  it('guards: a fractional keysCount is rejected', async () => {
    const csmCtx = fakeCtx('csm', makeFakeClient().client);
    await expect(createCsmOperator(csmCtx, { keysCount: 1.5 })).rejects.toThrow(/keysCount/);
  });
});

describe('createCsmOperator — gated (selector)', () => {
  beforeEach(clearIpfsEnv);
  afterEach(() => {
    vi.unstubAllGlobals();
    clearIpfsEnv();
  });

  it('whitelists via add-gate, proves against the merged tree, curveId bond, reports treeCid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dumpResponse([A(0x11)])));
    const { client, byMethod } = makeFakeClient({
      reads: {
        treeCid: CUR_CID,
        getRoleMember: ADMIN,
        isPaused: false,
        curveId: 2n,
        getBondAmountByKeysCount: parseEther('1.5'),
      },
      simulate: { result: 9n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED, selector: 'ics', cid: 'new-cid' });

    expect(res.noId).toBe(9n);
    expect(res.treeCid).toBe('new-cid');

    // proof is against the merged (current ∪ operator) tree that add-gate installed
    const union = [getAddress(A(0x11)), res.address].toSorted();
    const tree = buildAddressesTree(union);
    const writes = byMethod('writeContract') as any[];
    const set = writes.find((w) => w.functionName === 'setTreeParams');
    expect(set.args).toEqual([tree.root, 'new-cid']);
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.address).toBe(ICS_GATE);
    expect(sim.args).toHaveLength(6); // keysCount, keys, sigs, mgmt, proof, referrer
    expect(sim.args[4]).toEqual(tree.getProof([res.address]));
    expect(sim.args[5]).toBe(zeroAddress);
    expect(sim.value).toBe(parseEther('1.5'));

    // vetted-gate curve, not CURVE_ID
    const reads = byMethod('readContract') as any[];
    expect(reads.find((r) => r.functionName === 'curveId').address).toBe(ICS_GATE);
    expect(reads.find((r) => r.functionName === 'getBondAmountByKeysCount').args).toEqual([1n, 2n]);
  });

  it('resumes a paused gate as admin before creating (fresh gate → single-leaf empty proof)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        treeCid: '', // fresh gate — empty allowlist, no IPFS read
        getRoleMember: ADMIN,
        isPaused: true,
        curveId: 2n,
        getBondAmountByKeysCount: parseEther('1.5'),
      },
      simulate: { result: 3n, request: REQUEST },
    });
    const ctx = fakeCtx('csm', client);

    const res = await createCsmOperator(ctx, { seed: SEED, selector: 'ics', cid: 'new-cid' });

    const writes = byMethod('writeContract') as any[];
    const resumeGrant = writes.findIndex(
      (w) => w.functionName === 'grantRole' && w.args[0] === RESUME_ROLE,
    );
    const resume = writes.findIndex((w) => w.functionName === 'resume');
    const create = writes.findIndex((w) => w.isCreateReq);
    expect(resumeGrant).toBeGreaterThanOrEqual(0);
    expect(resume).toBeGreaterThan(resumeGrant);
    expect(create).toBeGreaterThan(resume);
    expect(writes[resume].account).toBe(ADMIN);

    // single-leaf tree → empty proof
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.args[4]).toEqual([]);
    expect(res.address).toBe(getAddress(deriveAddress(SEED, 'csm-operator')));
  });
});
