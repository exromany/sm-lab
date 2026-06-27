import { describe, expect, it } from 'vitest';
import { connect } from '../src/context';
import { operatorInfo } from '../src/recipes/operator-info';
import { revert, snapshot, warpBy } from '../src/recipes/chain';

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
});
