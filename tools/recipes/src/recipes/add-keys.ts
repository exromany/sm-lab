import type { Hex } from '@csm-lab/receipts';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';
import { randomKeys } from '../keys';

export interface AddKeysOptions {
  noId: bigint;
  count: number;
  /** Injectable seed for reproducible keys. */
  seed?: Hex;
}

export interface AddKeysResult {
  publicKeys: Hex[];
}

/**
 * Add `count` fresh validator keys to operator `noId`, paying the required bond, as the
 * operator's manager. Returns the generated pubkeys. (Port of `NodeOperators.addKeys`.)
 */
export async function addKeys(ctx: Ctx, opts: AddKeysOptions): Promise<AddKeysResult> {
  const m = contract(ctx, 'module');
  const acc = contract(ctx, 'Accounting');

  const op = await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperator',
    args: [opts.noId],
  });
  const manager = (op as { managerAddress: Hex }).managerAddress;

  const value = await ctx.client.readContract({
    ...acc,
    functionName: 'getRequiredBondForNextKeys',
    args: [opts.noId, BigInt(opts.count)],
  });

  const { publicKeys, packedKeys, packedSignatures } = randomKeys(opts.count, opts.seed);

  await actAs(ctx, manager, (from) =>
    ctx.client.writeContract({
      ...m,
      functionName: 'addValidatorKeysETH',
      args: [manager, opts.noId, BigInt(opts.count), packedKeys, packedSignatures],
      account: from,
      value: value as bigint,
      chain: null,
    }),
  );

  return { publicKeys };
}
