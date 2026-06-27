import { buildIcsTree } from '@csm-lab/merkle';
import { describe, expect, it } from 'vitest';
import {
  createCuratedOperator,
  createOperatorGroup,
  resetOperatorGroup,
  setBondCurveWeight,
} from '../src/cm/index';
import { SET_TREE_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const META_REGISTRY = A(0x2b); // cmBook().MetaRegistry
const ROLE = `0x${'11'.repeat(32)}`; // MANAGE_OPERATOR_GROUPS_ROLE
const ROLE2 = `0x${'22'.repeat(32)}`; // SET_BOND_CURVE_WEIGHT_ROLE
const MANAGER = A(0xb0);
const SETTER = A(0xb1);
const EMPTY_GROUP = { name: '', subNodeOperators: [], externalOperators: [] };

describe('createCuratedOperator', () => {
  it('installs an N=2 temp tree as admin, creates via the gate as the operator, then restores', async () => {
    const OPERATOR = A(0xc1);
    const EXTRA = A(0xc2);
    const ADMIN = A(0xd0);
    const GATE = A(0x30); // CuratedGates[0] = selector 'po'
    const ORIG_ROOT = `0x${'ab'.repeat(32)}`;
    const ORIG_CID = 'orig-cid';
    const REQUEST = { address: GATE, functionName: 'createNodeOperator', isCreateReq: true };

    const { client, byMethod } = makeFakeClient({
      reads: { treeRoot: ORIG_ROOT, treeCid: ORIG_CID, getRoleMember: ADMIN, isPaused: false },
      simulate: { result: 7n, request: REQUEST },
    });
    const ctx = fakeCtx('cm', client, { CuratedGates: [GATE] });

    const res = await createCuratedOperator(ctx, {
      selector: 'po',
      operator: OPERATOR,
      extra: EXTRA,
    });
    expect(res.noId).toBe(7n);

    const tree = buildIcsTree([OPERATOR, EXTRA]);
    const writes = byMethod('writeContract') as any[];

    // temp tree installed with the computed root + a synthetic non-empty cid, as admin
    const setTemp = writes.find(
      (w) => w.functionName === 'setTreeParams' && w.args[0] === tree.root,
    );
    expect(setTemp).toBeTruthy();
    expect(setTemp.args[1]).toMatch(/^tmp-cid-/);
    expect(setTemp.account).toBe(ADMIN);

    // SET_TREE_ROLE granted to admin
    expect(writes.some((w) => w.functionName === 'grantRole' && w.args[0] === SET_TREE_ROLE)).toBe(
      true,
    );

    // operator creation used the proof for the operator's leaf (by value)
    const sim = byMethod('simulateContract')[0] as any;
    expect(sim.functionName).toBe('createNodeOperator');
    expect(sim.account).toBe(OPERATOR);
    expect(sim.args[4]).toEqual(tree.getProof([OPERATOR]));

    // the create write reused the simulate request
    expect(writes.some((w) => w.isCreateReq === true)).toBe(true);

    // original tree restored (root + cid)
    expect(
      writes.some(
        (w) =>
          w.functionName === 'setTreeParams' && w.args[0] === ORIG_ROOT && w.args[1] === ORIG_CID,
      ),
    ).toBe(true);

    // the restore must come AFTER the create (operator created against the temp tree)
    const createIdx = writes.findIndex((w) => w.isCreateReq === true);
    const restoreIdx = writes.findIndex(
      (w) =>
        w.functionName === 'setTreeParams' && w.args[0] === ORIG_ROOT && w.args[1] === ORIG_CID,
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(restoreIdx).toBeGreaterThan(createIdx);

    // both privileged accounts impersonated
    const impersonated = byMethod('impersonateAccount');
    expect(impersonated).toContainEqual({ address: ADMIN });
    expect(impersonated).toContainEqual({ address: OPERATOR });
  });

  it('guards on ctx.module', async () => {
    const ctx = fakeCtx('csm', makeFakeClient().client);
    await expect(createCuratedOperator(ctx, { selector: 'po', operator: A(0xc1) })).rejects.toThrow(
      /requires ctx.module/,
    );
  });
});

describe('createOperatorGroup', () => {
  it('writes a single group as the manager when no operator is in a group (T1)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        MANAGE_OPERATOR_GROUPS_ROLE: ROLE,
        getRoleMember: MANAGER,
        NO_GROUP_ID: 0n,
        getNodeOperatorGroupId: () => 0n,
      },
    });
    const ctx = fakeCtx('cm', client);

    const res = await createOperatorGroup(ctx, {
      pairs: [
        [1n, 6000n],
        [2n, 4000n],
      ],
    });

    // role read by name, then getRoleMember(role, 0)
    const reads = byMethod('readContract') as any[];
    expect(reads.some((r) => r.functionName === 'MANAGE_OPERATOR_GROUPS_ROLE')).toBe(true);
    expect(byMethod('readContract')).toContainEqual(
      expect.objectContaining({ functionName: 'getRoleMember', args: [ROLE, 0n] }),
    );

    const writes = byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1); // no resets
    expect(writes[0].functionName).toBe('createOrUpdateOperatorGroup');
    expect(writes[0].args).toEqual([
      0n,
      {
        name: '',
        subNodeOperators: [
          { nodeOperatorId: 1n, share: 6000 },
          { nodeOperatorId: 2n, share: 4000 },
        ],
        externalOperators: [],
      },
    ]);
    expect(writes[0].account).toBe(MANAGER);
    expect(writes[0].address).toBe(META_REGISTRY);
    expect(writes[0].chain).toBe(null);

    expect(byMethod('impersonateAccount')).toContainEqual({ address: MANAGER });

    expect(res.resetGroupIds).toEqual([]);
    expect(res.subNodeOperators).toEqual([
      { nodeOperatorId: 1n, share: 6000 },
      { nodeOperatorId: 2n, share: 4000 },
    ]);
  });

  it('resets a pre-existing membership before the create (T2)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        MANAGE_OPERATOR_GROUPS_ROLE: ROLE,
        getRoleMember: MANAGER,
        NO_GROUP_ID: 0n,
        getNodeOperatorGroupId: (args: unknown[]) => (args[0] === 2n ? 99n : 0n),
      },
    });
    const ctx = fakeCtx('cm', client);

    const res = await createOperatorGroup(ctx, {
      pairs: [
        [1n, 6000n],
        [2n, 4000n],
      ],
    });

    const writes = byMethod('writeContract') as any[];
    expect(writes).toHaveLength(2);
    expect(writes[0].args).toEqual([99n, EMPTY_GROUP]); // reset first
    expect(writes[0].account).toBe(MANAGER);
    expect(writes[1].args[0]).toBe(0n); // create against NO_GROUP_ID
    expect(writes[1].account).toBe(MANAGER);
    expect(res.resetGroupIds).toEqual([99n]);
  });

  it('de-dups when two operators share one pre-existing group (T2b)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        MANAGE_OPERATOR_GROUPS_ROLE: ROLE,
        getRoleMember: MANAGER,
        NO_GROUP_ID: 0n,
        getNodeOperatorGroupId: () => 77n, // both operators in group 77
      },
    });
    const ctx = fakeCtx('cm', client);

    const res = await createOperatorGroup(ctx, {
      pairs: [
        [1n, 5000n],
        [2n, 5000n],
      ],
    });

    const writes = byMethod('writeContract') as any[];
    const resets = writes.filter((w) => w.args[0] === 77n);
    expect(resets).toHaveLength(1); // exactly ONE reset write
    expect(resets[0].args).toEqual([77n, EMPTY_GROUP]); // reset to the empty group
    expect(writes).toHaveLength(2); // reset + create
    expect(res.resetGroupIds).toEqual([77n]); // one entry only
  });

  it('throws on empty pairs without any chain call (T3)', async () => {
    const { client, byMethod } = makeFakeClient();
    const ctx = fakeCtx('cm', client);
    await expect(createOperatorGroup(ctx, { pairs: [] })).rejects.toThrow(/≥1|pair/);
    expect(byMethod('readContract')).toHaveLength(0); // validation throws before any read
    expect(byMethod('writeContract')).toHaveLength(0);
    expect(byMethod('impersonateAccount')).toHaveLength(0);
  });

  it('throws when shares do not sum to 10000 without any chain call (T4)', async () => {
    const { client, byMethod } = makeFakeClient();
    const ctx = fakeCtx('cm', client);
    await expect(
      createOperatorGroup(ctx, {
        pairs: [
          [1n, 6000n],
          [2n, 3000n],
        ],
      }),
    ).rejects.toThrow(/sum to 10000/);
    expect(byMethod('readContract')).toHaveLength(0); // validation throws before any read
    expect(byMethod('writeContract')).toHaveLength(0);
  });

  it('guards on ctx.module (T5)', async () => {
    const ctx = fakeCtx('csm', makeFakeClient().client);
    await expect(createOperatorGroup(ctx, { pairs: [[1n, 10000n]] })).rejects.toThrow(
      /requires ctx.module/,
    );
  });
});

describe('resetOperatorGroup', () => {
  it('resets the operator group as the manager (T6)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        MANAGE_OPERATOR_GROUPS_ROLE: ROLE,
        getRoleMember: MANAGER,
        NO_GROUP_ID: 0n,
        getNodeOperatorGroupId: () => 42n,
      },
    });
    const ctx = fakeCtx('cm', client);

    const res = await resetOperatorGroup(ctx, { noId: 7n });

    const writes = byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('createOrUpdateOperatorGroup');
    expect(writes[0].args).toEqual([42n, EMPTY_GROUP]);
    expect(writes[0].account).toBe(MANAGER);
    expect(writes[0].address).toBe(META_REGISTRY);
    expect(writes[0].chain).toBe(null);
    expect(byMethod('impersonateAccount')).toContainEqual({ address: MANAGER });
    expect(res.groupId).toBe(42n);
  });

  it('throws when the operator is in no group (T6b)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: {
        MANAGE_OPERATOR_GROUPS_ROLE: ROLE,
        getRoleMember: MANAGER,
        NO_GROUP_ID: 0n,
        getNodeOperatorGroupId: () => 0n,
      },
    });
    const ctx = fakeCtx('cm', client);
    await expect(resetOperatorGroup(ctx, { noId: 7n })).rejects.toThrow(/operator not in a group/);
    expect(byMethod('writeContract')).toHaveLength(0);
  });

  it('guards on ctx.module (T6c)', async () => {
    const ctx = fakeCtx('csm', makeFakeClient().client);
    await expect(resetOperatorGroup(ctx, { noId: 7n })).rejects.toThrow(/requires ctx.module/);
  });
});

describe('setBondCurveWeight', () => {
  it('sets the bond-curve weight as the weight setter (T7)', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { SET_BOND_CURVE_WEIGHT_ROLE: ROLE2, getRoleMember: SETTER },
    });
    const ctx = fakeCtx('cm', client);

    const res = await setBondCurveWeight(ctx, { curveId: 3n, weight: 250n });

    const reads = byMethod('readContract') as any[];
    expect(reads.some((r) => r.functionName === 'SET_BOND_CURVE_WEIGHT_ROLE')).toBe(true);
    expect(byMethod('readContract')).toContainEqual(
      expect.objectContaining({ functionName: 'getRoleMember', args: [ROLE2, 0n] }),
    );

    const writes = byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe('setBondCurveWeight');
    expect(writes[0].args).toEqual([3n, 250n]);
    expect(writes[0].account).toBe(SETTER);
    expect(writes[0].address).toBe(META_REGISTRY);
    expect(writes[0].chain).toBe(null);
    expect(byMethod('impersonateAccount')).toContainEqual({ address: SETTER });
    expect(res).toEqual({ curveId: 3n, weight: 250n });
  });

  it('guards on ctx.module (T7b)', async () => {
    const ctx = fakeCtx('csm', makeFakeClient().client);
    await expect(setBondCurveWeight(ctx, { curveId: 3n, weight: 250n })).rejects.toThrow(
      /requires ctx.module/,
    );
  });
});
