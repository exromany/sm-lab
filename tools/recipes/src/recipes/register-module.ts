import { stakingRouterAbi, type Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, type Ctx } from '../context';
import { DEFAULT_ADMIN_ROLE } from '../roles';
import { findModuleId, resolveModuleId } from './reads';

export interface StakingModuleConfig {
  stakeShareLimit: bigint;
  priorityExitShareThreshold: bigint;
  stakingModuleFee: bigint;
  treasuryFee: bigint;
  maxDepositsPerBlock: bigint;
  minDepositBlockDistance: bigint;
  withdrawalCredentialsType: bigint;
}

export interface RegisterModuleOptions {
  /** Staking module display name. Default: 'CSM 0x02' for csm02, else ctx.module. */
  name?: string;
  /** Staking-module id to clone the config from. Default: the first registered module id. */
  sourceModuleId?: bigint;
  /** Override any individual cloned config field; all others come from the source module. */
  stakeShareLimit?: bigint;
  priorityExitShareThreshold?: bigint;
  stakingModuleFee?: bigint;
  treasuryFee?: bigint;
  maxDepositsPerBlock?: bigint;
  minDepositBlockDistance?: bigint;
  /** Default: 2n for csm02 (EIP-7251), 1n otherwise. */
  withdrawalCredentialsType?: bigint;
}

export interface RegisterModuleResult {
  /** false when the module address was already registered (no write performed). */
  registered: boolean;
  moduleId: bigint;
  name?: string;
  config?: StakingModuleConfig;
}

interface StakingModuleView {
  stakingModuleAddress: Hex;
  stakeShareLimit: number;
  priorityExitShareThreshold: number;
  stakingModuleFee: number;
  treasuryFee: number;
  maxDepositsPerBlock: bigint;
  minDepositBlockDistance: bigint;
}

/**
 * Register `ctx.module`'s module contract in the StakingRouter (needed for csm02, which isn't
 * registered on the fork by default — `exitRequest`'s `resolveModuleId` throws until it is).
 * Idempotent: a no-op when the module address is already registered. Clones the economics
 * (`StakingModuleConfig`) from an already-registered module (`getStakingModule`), overriding only
 * `withdrawalCredentialsType` by default; `opts` can override any individual field. Grants
 * `STAKING_MODULE_MANAGE_ROLE` to the StakingRouter's default admin first if nobody holds it yet
 * (mirrors the `RESUME_ROLE` grant-then-act pattern in `createCsmOperator`).
 */
export async function registerModule(
  ctx: Ctx,
  opts: RegisterModuleOptions = {},
): Promise<RegisterModuleResult> {
  const m = contract(ctx, 'module');
  const existing = await findModuleId(ctx, m.address);
  if (existing !== undefined) return { registered: false, moduleId: existing };

  const sr = { address: ctx.addresses.stakingRouter, abi: stakingRouterAbi } as const;
  const manageRole = (await ctx.client.readContract({
    ...sr,
    functionName: 'STAKING_MODULE_MANAGE_ROLE',
  })) as Hex;
  const manageRoleMembers = (await ctx.client.readContract({
    ...sr,
    functionName: 'getRoleMemberCount',
    args: [manageRole],
  })) as bigint;

  let roleHolder: Hex;
  if (manageRoleMembers === 0n) {
    const admin = await roleMember(ctx, sr, DEFAULT_ADMIN_ROLE);
    await actAs(ctx, admin, (from) =>
      ctx.client.writeContract({
        ...sr,
        functionName: 'grantRole',
        args: [manageRole, admin],
        account: from,
        chain: null,
      }),
    );
    roleHolder = admin;
  } else {
    roleHolder = await roleMember(ctx, sr, manageRole);
  }

  const ids = (await ctx.client.readContract({
    ...sr,
    functionName: 'getStakingModuleIds',
  })) as bigint[];
  const sourceModuleId = opts.sourceModuleId ?? ids[0];
  if (sourceModuleId === undefined) {
    throw new Error(
      '@sm-lab/recipes: registerModule needs an already-registered module to clone the config from (none found)',
    );
  }
  const source = (await ctx.client.readContract({
    ...sr,
    functionName: 'getStakingModule',
    args: [sourceModuleId],
  })) as StakingModuleView;

  const config: StakingModuleConfig = {
    stakeShareLimit: opts.stakeShareLimit ?? BigInt(source.stakeShareLimit),
    priorityExitShareThreshold:
      opts.priorityExitShareThreshold ?? BigInt(source.priorityExitShareThreshold),
    stakingModuleFee: opts.stakingModuleFee ?? BigInt(source.stakingModuleFee),
    treasuryFee: opts.treasuryFee ?? BigInt(source.treasuryFee),
    maxDepositsPerBlock: opts.maxDepositsPerBlock ?? BigInt(source.maxDepositsPerBlock),
    minDepositBlockDistance: opts.minDepositBlockDistance ?? BigInt(source.minDepositBlockDistance),
    withdrawalCredentialsType: opts.withdrawalCredentialsType ?? (ctx.module === 'csm02' ? 2n : 1n),
  };
  const name = opts.name ?? (ctx.module === 'csm02' ? 'CSM 0x02' : ctx.module);

  await actAs(ctx, roleHolder, (from) =>
    ctx.client.writeContract({
      ...sr,
      functionName: 'addStakingModule',
      args: [name, m.address, config],
      account: from,
      chain: null,
    }),
  );

  const moduleId = await resolveModuleId(ctx, m.address);
  return { registered: true, moduleId, name, config };
}
