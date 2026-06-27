import { encodeAbiParameters, keccak256, parseAbiParameters, parseEther } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRewards, submitRewards, type RewardsReport } from '../src/recipes/rewards';
import { makeFakeClient, type FakeClientScript } from './helpers/fake-client';
import { A, fakeCtx } from './helpers/book';

const ZERO_ROOT = `0x${'00'.repeat(32)}`;

/** Build a `getNodeOperator` read that returns per-noId key counts (uint32 → NUMBER, as viem decodes). */
function nodeOperators(byId: Record<string, { deposited: number; withdrawn: number }>) {
  return (args: unknown) => {
    const noId = String((args as [bigint])[0]);
    const o = byId[noId] ?? { deposited: 0, withdrawn: 0 };
    return { totalDepositedKeys: o.deposited, totalWithdrawnKeys: o.withdrawn };
  };
}

/** A two-operator scenario: noId 0 → 5 active keys, noId 1 → 2 active keys. */
const TWO_OPS: FakeClientScript = {
  reads: {
    getNodeOperatorsCount: 2n,
    getNodeOperator: nodeOperators({
      '0': { deposited: 5, withdrawn: 0 },
      '1': { deposited: 3, withdrawn: 1 },
    }),
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.IPFS_API_URL;
});

describe('makeRewards', () => {
  it('T-R1: deterministic treeRoot + distributed with fixed seed and escape-hatch cids (no network)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { client } = makeFakeClient(TWO_OPS);

    const report = await makeRewards(fakeCtx('csm', client), {
      seed: '0x01',
      previousCumulatives: [],
      treeCid: 'cid-t',
      logCid: 'cid-l',
      now: 1_700_000_000,
    });

    // Pinned against the seeded keccak draw — regenerate only on a deliberate algorithm change.
    expect(report.treeRoot).toBe(
      '0x5a9425705c8eba425524a31fcc3a72225dc0c5278e979ec5f6282c84889ffec2',
    );
    expect(report.distributed).toBe(1_090_292_945_819_828_630n);
    expect(report.rebate).toBe(0n);
    expect(report.treeCid).toBe('cid-t');
    expect(report.logCid).toBe('cid-l');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-R2: carries previous cumulatives forward and adds this frame delta (pad excluded)', async () => {
    const { client } = makeFakeClient({
      reads: {
        getNodeOperatorsCount: 1n,
        getNodeOperator: nodeOperators({ '0': { deposited: 4, withdrawn: 0 } }),
      },
    });

    const report = await makeRewards(fakeCtx('csm', client), {
      seed: '0x03',
      previousCumulatives: [[0n, 500n]],
      treeCid: 'cid-t',
      logCid: 'cid-l',
      now: 1_700_000_000,
    });

    // delta for op0 (4 active keys, seed 0x03) = 616072179155251334
    expect(report.cumulatives.get(0n)).toBe(500n + 616_072_179_155_251_334n);
    expect(report.cumulatives.has((1n << 64n) - 1n)).toBe(false); // pad never in cumulatives
  });

  it('T-R3: pads a lone active operator with [PAD_NO_ID, 0n] (two leaves)', async () => {
    const { client } = makeFakeClient({
      reads: {
        getNodeOperatorsCount: 1n,
        getNodeOperator: nodeOperators({ '0': { deposited: 3, withdrawn: 0 } }),
      },
    });

    const report = await makeRewards(fakeCtx('csm', client), {
      seed: '0x02',
      treeCid: 'cid-t',
      logCid: 'cid-l',
      now: 1_700_000_000,
    });

    expect(report.treeRoot).toBe(
      '0xdfb86f23ab668f2e07233264f7078f4da86ada1f9d2b1226426c6c1cd510203b',
    );
    expect(report.treeDump?.values).toHaveLength(2);
    // The pad is a leaf but is NOT carried in cumulatives.
    expect(report.cumulatives.size).toBe(1);
  });

  it('T-R4: skips inactive operators (deposited == withdrawn)', async () => {
    const { client } = makeFakeClient({
      reads: {
        getNodeOperatorsCount: 2n,
        getNodeOperator: nodeOperators({
          '0': { deposited: 3, withdrawn: 0 }, // active
          '1': { deposited: 4, withdrawn: 4 }, // inactive
        }),
      },
    });

    const report = await makeRewards(fakeCtx('csm', client), {
      seed: '0x05',
      treeCid: 'cid-t',
      logCid: 'cid-l',
      now: 1_700_000_000,
    });

    expect(report.cumulatives.has(0n)).toBe(true);
    expect(report.cumulatives.has(1n)).toBe(false);
  });

  it('T-R5: empty report (no active operators, no carry-forward) → zero root, no pin', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { client } = makeFakeClient({ reads: { getNodeOperatorsCount: 0n } });

    const report = await makeRewards(fakeCtx('csm', client), { seed: '0x01' });

    expect(report.treeRoot).toBe(ZERO_ROOT);
    expect(report.treeCid).toBe('');
    expect(report.logCid).toBe('');
    expect(report.distributed).toBe(0n);
    expect(report.treeDump).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-R6: pin guard — no cids + no IPFS env throws BEFORE any network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    delete process.env.IPFS_API_URL; // ensure shouldAttemptPin() is false
    const { client } = makeFakeClient(TWO_OPS);

    await expect(makeRewards(fakeCtx('csm', client), { seed: '0x01' })).rejects.toThrow(
      /IPFS_API_URL|opts\.treeCid/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-R7: pins tree + log when configured; the LOG body has bigints serialized as strings', async () => {
    process.env.IPFS_API_URL = 'http://ipfs.test';
    const bodies: string[] = [];
    const fetchSpy = vi.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return {
        ok: true,
        json: async () => ({ IpfsHash: 'QmFake' }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { client } = makeFakeClient(TWO_OPS);

    const report = await makeRewards(fakeCtx('csm', client), {
      seed: '0x01',
      previousCumulatives: [],
      now: 1_700_000_000,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2); // tree + log
    expect(report.treeCid).toBe('QmFake');
    expect(report.logCid).toBe('QmFake');

    // The log pin must not throw on bigint; nested bigint fields are serialized as strings.
    const logBody = bodies[1]; // log is the second pin (tree pinned first)
    expect(logBody).toBeDefined();
    const parsed = JSON.parse(logBody!) as {
      pinataContent: {
        distributed_rewards: unknown;
        operators: Record<string, { distributed_rewards: unknown }>;
      };
    };
    expect(typeof parsed.pinataContent.distributed_rewards).toBe('string');
    expect(typeof parsed.pinataContent.operators['0']!.distributed_rewards).toBe('string');
  });

  it('T-R8: seed reproducibility — same seed/inputs → identical root + distributed; different seed differs', async () => {
    const mk = (seed: string) =>
      makeRewards(fakeCtx('csm', makeFakeClient(TWO_OPS).client), {
        seed: seed as `0x${string}`,
        previousCumulatives: [],
        treeCid: 'cid-t',
        logCid: 'cid-l',
        now: 1_700_000_000,
      });

    const a = await mk('0x01');
    const b = await mk('0x01');
    expect(a.treeRoot).toBe(b.treeRoot);
    expect(a.distributed).toBe(b.distributed);

    const c = await mk('0x02');
    expect(c.distributed).not.toBe(a.distributed);
  });
});

// ---------------------------------------------------------------------------------------------------
// submitRewards — hermetic. The fake client records every call; tests assert the CALL SEQUENCE, the
// funding literals, the warp ARGUMENTS, and the reportHash — NOT real frame advancement (that is only
// verifiable in the opt-in fork smoke). The reportHash encoding (tuple field order + tuple-vs-flat) is
// pinned two ways: an independent recompute AND one frozen golden literal (T-S8).
// ---------------------------------------------------------------------------------------------------

const TREE_ROOT = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;

/** A non-zero RewardsReport fixture (the data half submitRewards consumes). */
function baseReport(over: Partial<RewardsReport> = {}): RewardsReport {
  return {
    treeRoot: TREE_ROOT,
    treeCid: 'cid-tree',
    logCid: 'cid-log',
    distributed: parseEther('1'),
    rebate: 0n,
    cumulatives: new Map<bigint, bigint>(),
    ...over,
  };
}

/** Mirror of production REPORT_DATA_PARAMS — kept separate so a transcription drift fails loudly. */
const PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, bytes32 treeRoot, string treeCid, string logCid, uint256 distributed, uint256 rebate, bytes32 strikesTreeRoot, string strikesTreeCid)',
);
const strikesRoot = (refSlot: bigint): `0x${string}` =>
  keccak256(encodeAbiParameters(parseAbiParameters('string, uint256'), ['mock-strikes', refSlot]));

/** Independently recompute the full ReportData tuple + reportHash a test expects. */
function expectedData(report: RewardsReport, consensusVersion: bigint, refSlot: bigint) {
  return {
    consensusVersion,
    refSlot,
    treeRoot: report.treeRoot,
    treeCid: report.treeCid,
    logCid: report.logCid,
    distributed: report.distributed,
    rebate: report.rebate,
    strikesTreeRoot: strikesRoot(refSlot),
    strikesTreeCid: `mock-strikes-${refSlot}`,
  };
}
function expectedHash(report: RewardsReport, consensusVersion: bigint, refSlot: bigint) {
  return keccak256(encodeAbiParameters(PARAMS, [expectedData(report, consensusVersion, refSlot)]));
}

const M0 = A(0xaa01);
const M1 = A(0xaa02);

/** Scripted consensus reads for the happy path. Defaults: pending >= needed (no funding). */
function consensusScript(over: Partial<FakeClientScript['reads']> = {}): FakeClientScript['reads'] {
  return {
    pendingSharesToDistribute: parseEther('100'),
    getChainConfig: [32n, 12n, 1_600_000_000n], // slotsPerEpoch, secondsPerSlot, genesisTime
    getFrameConfig: [0n, 8n, 10n], // initialEpoch, epochsPerFrame, fastLaneLengthSlots
    getCurrentFrame: [12_345n, 99_999n], // refSlot, deadline
    getConsensusVersion: 3n,
    getContractVersion: 2n,
    getFastLaneMembers: [
      [M0, M1],
      [0n, 0n],
    ],
    getMembers: [
      [M0, M1],
      [0n, 0n],
    ],
    ...over,
  };
}

describe('submitRewards', () => {
  it('T-S1: zero treeRoot → { submitted: false }, no reads/writes/warps', async () => {
    const { client, order } = makeFakeClient({ reads: consensusScript() });
    const result = await submitRewards(
      fakeCtx('csm', client),
      baseReport({ treeRoot: ZERO_ROOT as `0x${string}` }),
    );

    expect(result).toEqual({ submitted: false });
    expect(order()).toHaveLength(0);
  });

  it('T-S2: funding branch (pending < needed) — setBalance X+2e, impersonate, submit X+1e, stop', async () => {
    const x = parseEther('5');
    const { client, byMethod, order } = makeFakeClient({
      // Already in-frame so the frame-wait does not add noise; force pending < distributed.
      blockTimestamp: 1_700_000_000n,
      reads: consensusScript({
        pendingSharesToDistribute: 0n,
        getPooledEthByShares: x,
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport({ distributed: parseEther('1') }));

    const fd = A(0x03); // FeeDistributor in csmBook
    const setBal = byMethod('setBalance')[0] as { address: `0x${string}`; value: bigint };
    expect(setBal.address).toBe(fd);
    expect(setBal.value).toBe(x + parseEther('2'));

    const submit = byMethod('writeContract').find(
      (w) => (w as { functionName: string }).functionName === 'submit',
    ) as { args: unknown[]; value: bigint; account: `0x${string}` };
    expect(submit.args).toEqual(['0x0000000000000000000000000000000000000000']);
    expect(submit.value).toBe(x + parseEther('1'));
    expect(submit.account).toBe(fd);

    // Order discipline: setBalance → impersonate → writeContract(submit) → stop.
    const seq = order();
    const iSet = seq.indexOf('setBalance');
    const iImp = seq.indexOf('impersonateAccount');
    const iStop = seq.indexOf('stopImpersonatingAccount');
    const iSubmit = seq.findIndex((m, idx) => m === 'writeContract' && idx > iImp);
    expect(iSet).toBeLessThan(iImp);
    expect(iImp).toBeLessThan(iSubmit);
    expect(iSubmit).toBeLessThan(iStop);
  });

  it('T-S3: pending >= needed → no funding (no getPooledEthByShares, no submit write)', async () => {
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 1_700_000_000n,
      reads: consensusScript({ pendingSharesToDistribute: parseEther('100') }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport({ distributed: parseEther('1') }));

    const reads = byMethod('readContract').map((a) => (a as { functionName: string }).functionName);
    expect(reads).not.toContain('getPooledEthByShares');
    const submits = byMethod('writeContract').filter(
      (w) => (w as { functionName: string }).functionName === 'submit',
    );
    expect(submits).toHaveLength(0);
  });

  it('T-S4: frame-wait — epoch < initialEpoch warps twice (both args asserted)', async () => {
    const genesisTime = 1_600_000_000n;
    const slotsPerEpoch = 32n;
    const secondsPerSlot = 12n;
    const initialEpoch = 10n;
    const epochsPerFrame = 8n;
    const refSlot = 12_345n;

    // ts0 → epoch 0 < 10 (first warp fires). After it, the block reads a fresh ts1 that is still
    // < frameStart (second warp fires). Advanceable timestamps: [ts0, ts1].
    const firstWarp = genesisTime + 1n + initialEpoch * slotsPerEpoch * secondsPerSlot;
    const frameStart =
      genesisTime + (refSlot + slotsPerEpoch * epochsPerFrame + 1n) * secondsPerSlot;
    const ts0 = genesisTime; // epoch 0
    const ts1 = firstWarp; // still well below frameStart

    const { client, byMethod } = makeFakeClient({
      blockTimestamp: [ts0, ts1],
      reads: consensusScript({
        getChainConfig: [slotsPerEpoch, secondsPerSlot, genesisTime],
        getFrameConfig: [initialEpoch, epochsPerFrame, 10n],
        getCurrentFrame: [refSlot, 99_999n],
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport());

    const warps = byMethod('setNextBlockTimestamp').map(
      (a) => (a as { timestamp: bigint }).timestamp,
    );
    expect(warps).toEqual([firstWarp, frameStart]);
  });

  it('T-S5: frame-wait — already in frame (epoch >= initialEpoch, ts past frameStart) → no warps', async () => {
    // genesis 0, far-future block timestamp, initialEpoch 0 → epoch huge >= 0, frameStart tiny < ts.
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getCurrentFrame: [100n, 9_999n],
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport());

    expect(byMethod('setNextBlockTimestamp')).toHaveLength(0);
  });

  it('T-S6: fast-lane empty → getMembers fallback drives the member loop', async () => {
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getFastLaneMembers: [[], []],
        getMembers: [
          [M0, M1],
          [0n, 0n],
        ],
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport());

    const reads = byMethod('readContract').map((a) => (a as { functionName: string }).functionName);
    expect(reads).toContain('getMembers');
    const submitReports = byMethod('writeContract').filter(
      (w) => (w as { functionName: string }).functionName === 'submitReport',
    );
    expect(submitReports).toHaveLength(2); // both fallback members
  });

  it('T-S7: fast-lane non-empty → getMembers NOT read; both members submit', async () => {
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getFastLaneMembers: [
          [M0, M1],
          [0n, 0n],
        ],
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport());

    const reads = byMethod('readContract').map((a) => (a as { functionName: string }).functionName);
    expect(reads).not.toContain('getMembers');
    const submitReports = byMethod('writeContract').filter(
      (w) => (w as { functionName: string }).functionName === 'submitReport',
    );
    expect(submitReports).toHaveLength(2);
  });

  it('T-S8: reportHash — per-member submitReport args + independent recompute + frozen golden', async () => {
    const report = baseReport();
    const consensusVersion = 3n;
    const refSlot = 12_345n;
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getCurrentFrame: [refSlot, 99_999n],
        getConsensusVersion: consensusVersion,
      }),
    });

    const result = await submitRewards(fakeCtx('csm', client), report);

    const hash = expectedHash(report, consensusVersion, refSlot);
    expect(result.reportHash).toBe(hash);

    // Each submitReport got [refSlot, reportHash, consensusVersion].
    const submitReports = byMethod('writeContract').filter(
      (w) => (w as { functionName: string }).functionName === 'submitReport',
    ) as { args: unknown[] }[];
    expect(submitReports).toHaveLength(2);
    for (const w of submitReports) {
      expect(w.args).toEqual([refSlot, hash, consensusVersion]);
    }

    // Frozen golden vector (generated from the repo's viem) — catches a shared-library encoding
    // regression independent of the recompute above. data: cv=3, refSlot=12345, treeRoot=0x11..11,
    // treeCid='cid-tree', logCid='cid-log', distributed=1e18, rebate=0, strikes=keccak("mock-strikes",12345).
    expect(hash).toBe('0x97162fe78caac7d88d23b9e8be5a145cf2ffaf63462eadbcb6f635e104123070');
  });

  it('T-S9: submitReportData — final write as members[0] with [data, contractVersion], data === hashed data', async () => {
    const report = baseReport();
    const consensusVersion = 3n;
    const contractVersion = 2n;
    const refSlot = 12_345n;
    const { client, byMethod } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getCurrentFrame: [refSlot, 99_999n],
        getConsensusVersion: consensusVersion,
        getContractVersion: contractVersion,
      }),
    });

    await submitRewards(fakeCtx('csm', client), report);

    const reads = byMethod('readContract').map((a) => (a as { functionName: string }).functionName);
    expect(reads).toContain('getContractVersion');

    const submitData = byMethod('writeContract').find(
      (w) => (w as { functionName: string }).functionName === 'submitReportData',
    ) as { args: unknown[]; account: `0x${string}` };
    // members[0] sends it.
    expect(submitData.account).toBe(M0);
    expect(submitData.args[1]).toBe(contractVersion);
    // The submitted `data` is FIELD-IDENTICAL to the one that produced reportHash (no hash-one/submit-other).
    expect(submitData.args[0]).toEqual(expectedData(report, consensusVersion, refSlot));
  });

  it('T-S10: no members (fast-lane + getMembers both empty) → throws /no consensus members/', async () => {
    const { client } = makeFakeClient({
      blockTimestamp: 10_000_000_000n,
      reads: consensusScript({
        getChainConfig: [32n, 12n, 0n],
        getFrameConfig: [0n, 8n, 10n],
        getFastLaneMembers: [[], []],
        getMembers: [[], []],
      }),
    });

    await expect(submitRewards(fakeCtx('csm', client), baseReport())).rejects.toThrow(
      /no consensus members/,
    );
  });

  it('T-S11: full happy-path order — reads → fund → warps → reads → submitReport×2 → submitReportData', async () => {
    const x = parseEther('5');
    const genesisTime = 1_600_000_000n;
    const refSlot = 12_345n;
    const firstWarp = genesisTime + 1n + 10n * 32n * 12n;
    const { client, order } = makeFakeClient({
      blockTimestamp: [genesisTime, firstWarp],
      reads: consensusScript({
        pendingSharesToDistribute: 0n, // force funding
        getPooledEthByShares: x,
        getChainConfig: [32n, 12n, genesisTime],
        getFrameConfig: [10n, 8n, 10n],
        getCurrentFrame: [refSlot, 99_999n],
      }),
    });

    await submitRewards(fakeCtx('csm', client), baseReport());

    // Filter to the structural milestones (drop the bookkeeping reads/mines between them) and assert
    // the canonical discipline: fund(impersonate/submit/stop) → 2 warps → consensus(act-as ×3).
    const seq = order();
    const milestones = seq.filter(
      (m) =>
        m === 'setBalance' ||
        m === 'impersonateAccount' ||
        m === 'stopImpersonatingAccount' ||
        m === 'setNextBlockTimestamp' ||
        m === 'writeContract',
    );
    expect(milestones).toEqual([
      // fund FeeDistributor
      'setBalance',
      'impersonateAccount',
      'writeContract', // submit
      'stopImpersonatingAccount',
      // frame wait
      'setNextBlockTimestamp',
      'setNextBlockTimestamp',
      // member 0 submitReport (actAs: setBalance → impersonate → write → stop)
      'setBalance',
      'impersonateAccount',
      'writeContract',
      'stopImpersonatingAccount',
      // member 1 submitReport
      'setBalance',
      'impersonateAccount',
      'writeContract',
      'stopImpersonatingAccount',
      // submitReportData as members[0]
      'setBalance',
      'impersonateAccount',
      'writeContract',
      'stopImpersonatingAccount',
    ]);
  });
});
