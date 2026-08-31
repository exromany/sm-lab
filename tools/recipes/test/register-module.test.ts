import { describe, expect, it } from 'vitest';
import { registerModule } from '../src/recipes/register-module';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const ROLE = A(0xf0); // STAKING_MODULE_MANAGE_ROLE
const ADMIN = A(0xd0);
const MODULE_ADDR = A(0x01); // csm02Book().CSModule via csmBook()
const SOURCE = {
  stakingModuleAddress: A(0x77),
  stakeShareLimit: 500,
  priorityExitShareThreshold: 200,
  stakingModuleFee: 300,
  treasuryFee: 400,
  maxDepositsPerBlock: 150n,
  minDepositBlockDistance: 25n,
};

describe('registerModule — idempotent', () => {
  it('returns registered:false with no write when already registered', async () => {
    const fc = makeFakeClient({
      reads: {
        getStakingModuleIds: [1n],
        getStakingModule: () => ({ stakingModuleAddress: MODULE_ADDR }),
      },
    });
    const ctx = fakeCtx('csm02', fc.client, { CSModule: MODULE_ADDR });

    const res = await registerModule(ctx);

    expect(res).toEqual({ registered: false, moduleId: 1n });
    expect(fc.byMethod('writeContract')).toHaveLength(0);
    expect(fc.byMethod('impersonateAccount')).toHaveLength(0);
  });
});

describe('registerModule — grants + writes', () => {
  function reads() {
    let calls = 0;
    return {
      getStakingModuleIds: () => {
        calls += 1;
        return calls === 1 ? [1n] : [1n, 2n];
      },
      getStakingModule: (args: any) => {
        if (args[0] === 1n) return SOURCE;
        if (args[0] === 2n) return { ...SOURCE, stakingModuleAddress: MODULE_ADDR };
        throw new Error(`unexpected module id ${args[0]}`);
      },
      STAKING_MODULE_MANAGE_ROLE: ROLE,
      getRoleMemberCount: 0n,
      getRoleMember: ADMIN,
    };
  }

  it('grants STAKING_MODULE_MANAGE_ROLE to the admin when nobody holds it, clones the source config', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm02', fc.client, { CSModule: MODULE_ADDR });

    const res = await registerModule(ctx);

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(2);
    expect(writes[0].functionName).toBe('grantRole');
    expect(writes[0].args).toEqual([ROLE, ADMIN]);
    expect(writes[0].account).toBe(ADMIN);
    expect(writes[1].functionName).toBe('addStakingModule');
    expect(writes[1].account).toBe(ADMIN);
    expect(writes[1].args).toEqual([
      'CSM 0x02',
      MODULE_ADDR,
      {
        stakeShareLimit: 500n,
        priorityExitShareThreshold: 200n,
        stakingModuleFee: 300n,
        treasuryFee: 400n,
        maxDepositsPerBlock: 150n,
        minDepositBlockDistance: 25n,
        withdrawalCredentialsType: 2n,
      },
    ]);

    expect(res.registered).toBe(true);
    expect(res.moduleId).toBe(2n);
    expect(res.name).toBe('CSM 0x02');
    expect(res.config?.withdrawalCredentialsType).toBe(2n);
  });

  it('defaults withdrawalCredentialsType=1 and name=ctx.module for non-csm02 modules', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: MODULE_ADDR });

    const res = await registerModule(ctx);

    expect(res.name).toBe('csm');
    expect(res.config?.withdrawalCredentialsType).toBe(1n);
  });

  it('opts override the cloned config fields, name, and source module id', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm02', fc.client, { CSModule: MODULE_ADDR });

    const res = await registerModule(ctx, {
      name: 'Custom CSM',
      sourceModuleId: 1n,
      stakeShareLimit: 999n,
      withdrawalCredentialsType: 9n,
    });

    expect(res.name).toBe('Custom CSM');
    expect(res.config).toEqual({
      stakeShareLimit: 999n,
      priorityExitShareThreshold: 200n,
      stakingModuleFee: 300n,
      treasuryFee: 400n,
      maxDepositsPerBlock: 150n,
      minDepositBlockDistance: 25n,
      withdrawalCredentialsType: 9n,
    });
    const write = (fc.byMethod('writeContract') as any[]).find(
      (w) => w.functionName === 'addStakingModule',
    );
    expect(write.args[0]).toBe('Custom CSM');
  });
});

describe('registerModule — role already has a member', () => {
  it('skips the grant, acts as the existing role member directly', async () => {
    let calls = 0;
    const fc = makeFakeClient({
      reads: {
        // Before the write, only id 1n (the source) is registered; after, id 2n (this module)
        // also is — mimicking the fork state change the write causes.
        getStakingModuleIds: () => {
          calls += 1;
          return calls === 1 ? [1n] : [1n, 2n];
        },
        getStakingModule: (args: any) => {
          if (args[0] === 1n) return SOURCE;
          if (args[0] === 2n) return { ...SOURCE, stakingModuleAddress: MODULE_ADDR };
          throw new Error(`unexpected module id ${args[0]}`);
        },
        STAKING_MODULE_MANAGE_ROLE: ROLE,
        getRoleMemberCount: 1n,
        getRoleMember: A(0xee), // the existing manage-role member
      },
    });
    const ctx = fakeCtx('csm02', fc.client, { CSModule: MODULE_ADDR });

    const res = await registerModule(ctx);

    const writes = fc.byMethod('writeContract') as any[];
    expect(writes).toHaveLength(1); // no grantRole — straight to addStakingModule
    expect(writes[0].functionName).toBe('addStakingModule');
    expect(writes[0].account).toBe(A(0xee));
    expect(res.registered).toBe(true);
    expect(res.moduleId).toBe(2n);
  });
});

describe('registerModule — no module to clone from', () => {
  it('throws when there is no already-registered module and no sourceModuleId override', async () => {
    const fc = makeFakeClient({
      reads: {
        getStakingModuleIds: [],
        STAKING_MODULE_MANAGE_ROLE: ROLE,
        getRoleMemberCount: 1n,
        getRoleMember: ADMIN,
      },
    });
    const ctx = fakeCtx('csm02', fc.client, { CSModule: MODULE_ADDR });
    await expect(registerModule(ctx)).rejects.toThrow(/already-registered module to clone/);
  });
});
