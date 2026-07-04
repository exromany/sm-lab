import { describe, expect, it } from 'vitest';
import type { CsmAddressBook, Hex } from '@sm-lab/receipts';
import { csModuleAbi, feeDistributorAbi } from '@sm-lab/receipts';
import { connect } from '../src/context';
import { operatorInfo } from '../src/recipes/operator-info';
import { revert, snapshot, warpBy } from '../src/recipes/chain';
import { pause, resume } from '../src/recipes/pause';
import { makeRewards, submitRewards } from '../src/recipes/rewards';

const FORK_URL = process.env.ANVIL_FORK_URL;

// Opt-in only: skipped unless ANVIL_FORK_URL points at a running anvil fork
// (`anvil --fork-url <hoodi RPC>`). Kept out of the default `vitest run`.
describe.skipIf(!FORK_URL)('fork smoke (ANVIL_FORK_URL)', () => {
  it('connects, reads operator 0, and round-trips a snapshot/warp/revert', async () => {
    const ctx = await connect({ module: 'csm', rpcUrl: FORK_URL as string });
    expect(ctx.addresses.stakingRouter).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const info = await operatorInfo(ctx, { noId: 0n });
    expect(typeof info.totalAddedKeys).toBe('number');

    const snap = await snapshot(ctx);
    await warpBy(ctx, 86400);
    await revert(ctx, snap);
  });

  it('makeRewards → submitRewards round-trips an oracle report', async () => {
    // Needs IPFS configured (IPFS_API_URL → local @sm-lab/ipfs, or PINATA_*) OR escape cids.
    const ctx = await connect({ module: 'csm', rpcUrl: FORK_URL as string });
    const report = await makeRewards(ctx, { seed: '0x01', treeCid: 'cid-t', logCid: 'cid-l' });
    const result = await submitRewards(ctx, report);

    expect(typeof result.submitted).toBe('boolean');
    if (result.submitted) {
      expect(typeof result.refSlot).toBe('bigint');
      const onChainRoot = await ctx.client.readContract({
        address: ctx.addresses.FeeDistributor as Hex,
        abi: feeDistributorAbi,
        functionName: 'treeRoot',
      });
      expect(onChainRoot).toBe(report.treeRoot);
    }
  });

  it('pauses and resumes the module (round-trip, idempotent)', async () => {
    const ctx = await connect({ module: 'csm', rpcUrl: FORK_URL as string });

    const paused = await pause(ctx, { target: 'module' });
    expect(paused.paused).toBe(true);
    expect(
      await ctx.client.readContract({
        address: (ctx.addresses as CsmAddressBook).CSModule,
        abi: csModuleAbi,
        functionName: 'isPaused',
      }),
    ).toBe(true);

    const resumed = await resume(ctx, { target: 'module' });
    expect(resumed.paused).toBe(false);
  });
});
