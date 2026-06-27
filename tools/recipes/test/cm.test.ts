import { buildIcsTree } from '@csm-lab/merkle';
import { describe, expect, it } from 'vitest';
import { createCuratedOperator } from '../src/cm/index';
import { SET_TREE_ROLE } from '../src/roles';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

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
