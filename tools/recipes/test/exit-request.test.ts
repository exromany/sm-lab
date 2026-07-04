import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { exitRequest } from '../src/recipes/exit-request';
import { makeFakeClient } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

// A 48-byte BLS pubkey (0xab * 48) and the known packed data / hash for the vector below.
const PUBKEY = `0x${'ab'.repeat(48)}` as const;
// moduleId=3, noId=7, validatorIndex=900000 (0xdbba0):
//   bytes3(3)                = 000003
//   bytes5(7)                = 0000000007
//   bytes8(900000)           = 00000000000dbba0
//   pubkey (48 bytes)        = ab*48
const EXPECTED_DATA = `0x0000030000000007${'00000000000dbba0'}${'ab'.repeat(48)}` as const;

const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, uint256 requestsCount, uint256 dataFormat, bytes data)',
);

/** Base fake-client reads for a csm module registered at staking-module id 3, VEBO state fixed. */
function reads(moduleAddr = A(0x01)) {
  return {
    getSigningKeys: PUBKEY,
    getStakingModuleIds: [1n, 2n, 3n],
    getStakingModule: (args: any) =>
      args[0] === 3n ? { stakingModuleAddress: moduleAddr } : { stakingModuleAddress: A(0x99) },
    getConsensusReport: ['0x' + '00'.repeat(32), 5n, 0n, false], // refSlot = 5 → report refSlot = 6
    getConsensusVersion: 2n,
    getContractVersion: 4n,
    getConsensusContract: A(0xcc),
    SUBMIT_DATA_ROLE: ('0x' + '11'.repeat(32)) as `0x${string}`,
    getRoleMember: A(0xad), // VEBO DEFAULT_ADMIN_ROLE member 0 (via roleMember)
  };
}

describe('exitRequest', () => {
  it('packs the 64-byte request and submits consensus + report data', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });

    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n, validatorIndex: 900000n });

    // packed data (asserted via the submitReportData write below); result echoes inputs + discovered ids.
    expect(res.moduleId).toBe(3n);
    expect(res.refSlot).toBe(6n);
    expect(res.pubkey).toBe(PUBKEY);
    expect(res.validatorIndex).toBe(900000n);

    const writes = fc.byMethod('writeContract') as any[];
    // 1) submitConsensusReport as the consensus contract
    expect(writes[0].functionName).toBe('submitConsensusReport');
    expect(writes[0].account).toBe(A(0xcc));
    const [hashArg, refSlotArg, deadlineArg] = writes[0].args;
    expect(refSlotArg).toBe(6n);
    expect(deadlineArg).toBe(1_700_000_000n + 86400n); // block.timestamp + 1 day
    // 2) grantRole then 3) submitReportData, both as the admin
    expect(writes[1].functionName).toBe('grantRole');
    expect(writes[1].args).toEqual([reads().SUBMIT_DATA_ROLE, A(0xad)]);
    expect(writes[1].account).toBe(A(0xad));
    expect(writes[2].functionName).toBe('submitReportData');
    expect(writes[2].account).toBe(A(0xad));
    const [report, contractVersion] = writes[2].args;
    expect(contractVersion).toBe(4n);
    expect(report).toEqual({
      consensusVersion: 2n,
      refSlot: 6n,
      requestsCount: 1n,
      dataFormat: 1n,
      data: EXPECTED_DATA,
    });

    // reportHash: independently tuple-encoded (guards the flatten trap) — must match both writes.
    const expectedHash = keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [report]));
    expect(res.reportHash).toBe(expectedHash);
    expect(hashArg).toBe(expectedHash);
  });

  it('impersonates the consensus contract then the admin, in that order', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(fc.byMethod('impersonateAccount')).toEqual([{ address: A(0xcc) }, { address: A(0xad) }]);
  });

  it('defaults validatorIndex to 900000n', async () => {
    const fc = makeFakeClient({ reads: reads() });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(res.validatorIndex).toBe(900000n);
    const submit = (fc.byMethod('writeContract') as any[])[2];
    expect(submit.args[0].data).toBe(EXPECTED_DATA);
  });

  it('resolves the module id by scanning all staking-module ids (index 0 included)', async () => {
    const fc = makeFakeClient({
      reads: {
        ...reads(),
        getStakingModuleIds: [5n], // single id at index 0 — source would skip it and revert
        getStakingModule: (args: any) =>
          args[0] === 5n ? { stakingModuleAddress: A(0x01) } : { stakingModuleAddress: A(0x99) },
      },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    const res = await exitRequest(ctx, { noId: 0n, keyIndex: 0n });
    expect(res.moduleId).toBe(5n);
  });

  it('throws when the module is not registered in the StakingRouter', async () => {
    const fc = makeFakeClient({
      reads: { ...reads(), getStakingModule: () => ({ stakingModuleAddress: A(0x99) }) },
    });
    const ctx = fakeCtx('csm', fc.client, { CSModule: A(0x01) });
    await expect(exitRequest(ctx, { noId: 0n, keyIndex: 0n })).rejects.toThrow(/not registered/);
  });

  it('cm: reads getSigningKeys / matches module id on the CuratedModule address', async () => {
    const fc = makeFakeClient({ reads: reads(A(0x21)) }); // cm CuratedModule = A(0x21)
    const ctx = fakeCtx('cm', fc.client, { CuratedModule: A(0x21) });
    const res = await exitRequest(ctx, { noId: 7n, keyIndex: 1n });
    expect(res.moduleId).toBe(3n);
    // getSigningKeys was read on the CuratedModule address
    const sk = (fc.byMethod('readContract') as any[]).find(
      (r) => r.functionName === 'getSigningKeys',
    );
    expect(sk.address).toBe(A(0x21));
  });
});
