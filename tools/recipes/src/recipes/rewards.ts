import {
  buildRewardsTree,
  ipfsOptionsFromEnv,
  pinJsonToIpfs,
  shouldAttemptPin,
  type TreeDump,
} from '@csm-lab/merkle';
import { encodeAbiParameters, keccak256, parseAbiParameters, parseEther, toBytes } from 'viem';
import {
  feeDistributorAbi,
  feeOracleAbi,
  hashConsensusAbi,
  lidoAbi,
  type Hex,
} from '@csm-lab/receipts';
import { actAs } from '../act-as';
import { contract, type Ctx } from '../context';
import { randomSeed } from '../random';
import { operatorInfo } from './operator-info';
import { warpTo } from './chain';

/** Reward draw bounds (mirrors `mock-rewards.mjs`): per active key, in wei. */
const REWARD_MIN_WEI = 100_000_000_000_000_000n; // 0.1 ETH
const REWARD_MAX_WEI = 200_000_000_000_000_000n; // 0.2 ETH
const REWARD_SPAN = REWARD_MAX_WEI - REWARD_MIN_WEI; // 1e17
/** type(uint64).max — padding id for a lone real operator (FeeDistributor non-empty-proof rule). */
const PAD_NO_ID = (1n << 64n) - 1n;
/** Empty-tree sentinel root: 32 zero bytes. */
const ZERO_ROOT = `0x${'00'.repeat(32)}` as Hex;

export interface RewardsReport {
  /** tree.root, or ZERO_ROOT when there are no leaves. */
  treeRoot: Hex;
  /** pinned (or opts.treeCid); '' when treeRoot is zero. */
  treeCid: string;
  /** pinned (or opts.logCid); '' when treeRoot is zero. */
  logCid: string;
  /** Sum of all per-operator distributed rewards this frame. */
  distributed: bigint;
  /** Always 0n in the mock (matches the source). */
  rebate: bigint;
  /** In-memory OZ tree dump (uint256-as-string → JSON-safe) for tests / re-pin. Undefined when empty. */
  treeDump?: TreeDump;
  /** Cumulative leaves AFTER carry-forward + this frame's deltas, EXCLUDING the pad. */
  cumulatives: Map<bigint, bigint>;
}

export interface MakeRewardsOptions {
  /** Injectable seed → deterministic per-key reward draw. Omit for fresh randomness. */
  seed?: Hex;
  /** Carry-forward input: the previous cumulative tree as a Map (or [noId, shares][]). */
  previousCumulatives?: Map<bigint, bigint> | [bigint, bigint][];
  /** Hermetic escape hatch: skip pinning the tree, use this cid. */
  treeCid?: string;
  /** Hermetic escape hatch: skip pinning the log, use this cid. */
  logCid?: string;
  /** Injectable clock (unix seconds) for the report log's block_timestamp. Defaults Date.now()/1000. */
  now?: number;
}

/**
 * Build the cumulative FeeDistributor rewards tree off on-chain operator state and a seeded mock
 * reward per active key, pin the tree + report log to IPFS (guarded), and return a typed in-memory
 * `RewardsReport`. Port of `mock-rewards.mjs` — but the OUTPUT path stays bigint-typed (no bare
 * `JSON.stringify` of bigints), and the per-key draw is fully seeded (no `Math.random`) so tests can
 * pin `treeRoot`/`distributed`.
 *
 * Carry-forward is via `opts.previousCumulatives` only (option (a) of the design). The pure
 * carry-forward logic — carry every prior leaf forward except the pad, then add this frame's deltas —
 * is identical no matter where the prior Map came from, so the fork path chains calls:
 * `makeRewards(ctx, { previousCumulatives: prev.cumulatives })`.
 * TODO(6f?): on-chain `treeRoot()` → `treeCid()` → IPFS fetch of the prior tree as a default source.
 */
export async function makeRewards(ctx: Ctx, opts: MakeRewardsOptions = {}): Promise<RewardsReport> {
  // The all-bigint seeded draw deliberately diverges from the source's lossy
  // `BigInt(Math.floor(Math.random() * Number(REWARD_SPAN)))`: we keccak-hash the seed (32-byte
  // random when omitted, via the shared `randomSeed`) so the draw is reproducible and full-precision.
  const seed = opts.seed ?? randomSeed();

  const m = contract(ctx, 'module');
  const count = (await ctx.client.readContract({
    ...m,
    functionName: 'getNodeOperatorsCount',
  })) as bigint;

  // --- read every operator (parallel; independent reads), then draw seeded rewards per active key.
  // REUSE operatorInfo (typed; uint32 already decodes to `number` — no Number() casts). The draw is
  // keyed on `noId` so it is order-independent; we still walk in ascending noId for stable output. ---
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));
  const infos = await Promise.all(ids.map((noId) => operatorInfo(ctx, { noId })));

  const reportOperators: Record<string, { distributed_rewards: bigint }> = {};
  const frameDeltas = new Map<bigint, bigint>();
  let distributed = 0n;

  for (const [i, noId] of ids.entries()) {
    const info = infos[i]!;
    const activeKeys = info.totalDepositedKeys - info.totalWithdrawnKeys;
    if (activeKeys <= 0) continue;

    let opDistributed = 0n;
    for (let k = 0; k < activeKeys; k++) {
      opDistributed += REWARD_MIN_WEI + seededUint(seed, `reward:${noId}:${k}`, REWARD_SPAN);
    }
    reportOperators[noId.toString()] = { distributed_rewards: opDistributed };
    frameDeltas.set(noId, opDistributed);
    distributed += opDistributed;
  }

  const rebate = 0n;

  // --- carry-forward: prior cumulatives (pad excluded) + this frame's deltas ---
  const cumulatives = new Map<bigint, bigint>();
  for (const [noId, shares] of normalizePrevious(opts.previousCumulatives)) {
    if (noId !== PAD_NO_ID) cumulatives.set(noId, shares);
  }
  for (const [noId, delta] of frameDeltas) {
    cumulatives.set(noId, (cumulatives.get(noId) ?? 0n) + delta);
  }

  // --- build leaves; pad a lone real operator (FeeDistributor rejects empty proofs) ---
  const leaves = [...cumulatives.entries()].map(
    ([noId, shares]) => [noId, shares] as [bigint, bigint],
  );
  if (leaves.length === 1) leaves.push([PAD_NO_ID, 0n]);

  if (leaves.length === 0) {
    // Empty report: no tree, no pin. submitRewards (PR-2) will treat ZERO_ROOT as a graceful skip.
    return { treeRoot: ZERO_ROOT, treeCid: '', logCid: '', distributed, rebate, cumulatives };
  }

  const tree = buildRewardsTree(leaves);
  const treeRoot = tree.root as Hex;

  // Guard before the IPFS pin (the only `fetch` this recipe makes) so hermetic tests with no IPFS
  // env and no escape cids fail loudly instead of hitting the wire. Mirrors `setGateAddrs.pinTree`.
  // Sits AFTER the empty-report return so an empty fork never needs IPFS configured.
  const needsPin = opts.treeCid === undefined || opts.logCid === undefined;
  if (needsPin && !shouldAttemptPin()) {
    throw new Error(
      '@csm-lab/recipes: could not pin the rewards tree/log — set IPFS_API_URL (a local @csm-lab/ipfs-mock) or PINATA_* credentials, or pass opts.treeCid + opts.logCid',
    );
  }

  // The report log (faithful-but-minimal mock shape) has bigints nested in operators[*] +
  // distributable/distributed_rewards/rebate_to_protocol. OZ `dump()` returns the original leaf
  // values verbatim (no serialization step) — since we built the tree from `[bigint, bigint]`
  // leaves, `dump().values[*].value` holds bigints too. `pinJsonToIpfs` JSON.stringifies internally
  // (throws on bigint), so normalize BOTH through one replacer (delta #2) rather than touching each field.
  const blockTimestamp = opts.now ?? Math.floor(Date.now() / 1000);
  const log = {
    blockstamp: { block_timestamp: blockTimestamp },
    distributable: distributed,
    distributed_rewards: distributed,
    rebate_to_protocol: rebate,
    operators: reportOperators,
  };
  const treeDump = toJsonSafe(tree.dump()) as TreeDump;

  const treeCid =
    opts.treeCid ?? (await pinJsonToIpfs(treeDump, 'rewards-tree', ipfsOptionsFromEnv()));
  const logCid =
    opts.logCid ?? (await pinJsonToIpfs(toJsonSafe(log), 'rewards-log', ipfsOptionsFromEnv()));

  return { treeRoot, treeCid, logCid, distributed, rebate, treeDump, cumulatives };
}

/** Deterministic uint in `[0, span)` from `keccak256(toBytes(\`${seed}:${label}\`)) % span`. */
function seededUint(seed: Hex, label: string, span: bigint): bigint {
  return BigInt(keccak256(toBytes(`${seed}:${label}`))) % span;
}

/** Deep-clone `value` to a fully bigint-free object (bigints → decimal strings) for JSON pinning. */
function toJsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/** Normalize the carry-forward input (Map or entries) to an iterable of [noId, shares]. */
function normalizePrevious(
  prev: MakeRewardsOptions['previousCumulatives'],
): Iterable<[bigint, bigint]> {
  if (!prev) return [];
  return prev instanceof Map ? prev.entries() : prev;
}

// --- submitRewards (port of OracleReport.s.sol:submitRewards) -------------------------------------

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/**
 * The `IFeeOracle.ReportData` struct as ONE tuple parameter — components in declaration order
 * (verified against `fixtures/receipts/src/abi/FeeOracle.ts`). `abi.encode(data)` for a single
 * struct == ABI-encoding one tuple parameter (head/tail offsets for the dynamic `string` fields);
 * passing the tuple type as a single param to `encodeAbiParameters` reproduces it. Do NOT flatten
 * into 9 top-level params — that drops the tuple offset and changes the hash. This is the exact
 * reportHash transcription trap.
 */
const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, bytes32 treeRoot, string treeCid, string logCid, uint256 distributed, uint256 rebate, bytes32 strikesTreeRoot, string strikesTreeCid)',
);

/** The 9-field oracle ReportData tuple (bigints for the uint256 fields). */
interface ReportData {
  consensusVersion: bigint;
  refSlot: bigint;
  treeRoot: Hex;
  treeCid: string;
  logCid: string;
  distributed: bigint;
  rebate: bigint;
  strikesTreeRoot: Hex;
  strikesTreeCid: string;
}

export interface SubmitRewardsResult {
  /** false when treeRoot is zero (a legitimate empty-report skip). */
  submitted: boolean;
  /** present when submitted: the consensus frame's refSlot. */
  refSlot?: bigint;
  /** echo of report.treeRoot when submitted. */
  treeRoot?: Hex;
  /** the keccak256(abi.encode(data)) reached consensus on. */
  reportHash?: Hex;
  /** the consensus members that submitted (fast-lane, or the getMembers fallback). */
  members?: Hex[];
}

/**
 * Submit a `RewardsReport` (from `makeRewards`) on-chain: fund the FeeDistributor, warp to the next
 * consensus frame, build the `ReportData` tuple, reach consensus across the fast-lane members (with
 * a `getMembers` fallback), and submit the report data. Port of `OracleReport.s.sol:submitRewards`.
 *
 * Fork-only in practice (it WRITES + warps); the hermetic tests assert the call sequence, the funding
 * literals, the warp arguments, and the reportHash, not real frame advancement.
 *
 * A zero-root report (no active keys this frame) is a graceful no-op: returns `{ submitted: false }`
 * with no reads/writes, so `submitRewards(ctx, await makeRewards(ctx))` composes on an empty fork.
 */
export async function submitRewards(ctx: Ctx, report: RewardsReport): Promise<SubmitRewardsResult> {
  if (report.treeRoot === ZERO_ROOT) return { submitted: false };

  const feeDistributor = { address: ctx.addresses.FeeDistributor as Hex, abi: feeDistributorAbi };
  const oracle = { address: ctx.addresses.FeeOracle as Hex, abi: feeOracleAbi };
  const hashConsensus = { address: ctx.addresses.HashConsensus as Hex, abi: hashConsensusAbi };
  const lido = { address: ctx.addresses.lido, abi: lidoAbi };

  // --- 1. Fund the FeeDistributor with stETH shares if it cannot cover this frame ---
  const pending = (await ctx.client.readContract({
    ...feeDistributor,
    functionName: 'pendingSharesToDistribute',
  })) as bigint;
  if (pending < report.distributed + report.rebate) {
    const neededShares = report.distributed + report.rebate - pending;
    // X = getPooledEthByShares(neededShares); submit value = X + 1 ether; setBalance = X + 2 ether
    // (matches the source's `neededEth = X + 1 ether; _setBalance(fd, neededEth + 1 ether)`).
    // Inline the impersonation (not actAs) so the funding survives — actAs would clobber the
    // balance back to 100 ETH, which can be < the needed amount for large rewards.
    const x = (await ctx.client.readContract({
      ...lido,
      functionName: 'getPooledEthByShares',
      args: [neededShares],
    })) as bigint;
    const submitValue = x + parseEther('1');
    const fd = feeDistributor.address;
    await ctx.client.setBalance({ address: fd, value: x + parseEther('2') });
    await ctx.client.impersonateAccount({ address: fd });
    try {
      await ctx.client.writeContract({
        ...lido,
        functionName: 'submit',
        args: [ZERO_ADDRESS],
        value: submitValue,
        account: fd,
        chain: null,
      });
    } finally {
      await ctx.client.stopImpersonatingAccount({ address: fd });
    }
  }

  // --- 2. Warp to the next valid consensus frame (_waitForNextRefSlot) — all bigint math ---
  const [slotsPerEpoch, secondsPerSlot, genesisTime] = (await ctx.client.readContract({
    ...hashConsensus,
    functionName: 'getChainConfig',
  })) as [bigint, bigint, bigint];
  const [initialEpoch, epochsPerFrame] = (await ctx.client.readContract({
    ...hashConsensus,
    functionName: 'getFrameConfig',
  })) as [bigint, bigint, bigint];

  const ts = (await ctx.client.getBlock()).timestamp;
  const epoch = (ts - genesisTime) / secondsPerSlot / slotsPerEpoch;
  if (epoch < initialEpoch) {
    await warpTo(ctx, genesisTime + 1n + initialEpoch * slotsPerEpoch * secondsPerSlot);
  }

  const [frameRefSlot] = (await ctx.client.readContract({
    ...hashConsensus,
    functionName: 'getCurrentFrame',
  })) as [bigint, bigint];
  const frameStart =
    genesisTime + (frameRefSlot + slotsPerEpoch * epochsPerFrame + 1n) * secondsPerSlot;
  const ts2 = (await ctx.client.getBlock()).timestamp;
  if (frameStart > ts2) {
    await warpTo(ctx, frameStart);
  }

  // Re-read the frame AFTER the warp: the report must carry the now-current refSlot, not the
  // pre-warp one (the warp deliberately advances a full frame past `frameRefSlot`). The source
  // reads getCurrentFrame() again right after `_waitForNextRefSlot()` (OracleReport.s.sol:46);
  // inlining the wait must not drop that second read, or submitReport/submitReportData land on a
  // stale refSlot and HashConsensus reverts.
  const [refSlot] = (await ctx.client.readContract({
    ...hashConsensus,
    functionName: 'getCurrentFrame',
  })) as [bigint, bigint];

  // --- 3. Build ReportData (mock strikes values) + reportHash ---
  const consensusVersion = (await ctx.client.readContract({
    ...oracle,
    functionName: 'getConsensusVersion',
  })) as bigint;
  const data: ReportData = {
    consensusVersion,
    refSlot,
    treeRoot: report.treeRoot,
    treeCid: report.treeCid,
    logCid: report.logCid,
    distributed: report.distributed,
    rebate: report.rebate,
    strikesTreeRoot: strikesTreeRoot(refSlot),
    strikesTreeCid: `mock-strikes-${refSlot}`,
  };
  const hash = reportHash(data);

  // --- 4. Members with fast-lane → getMembers fallback (the Fixtures.sol fallback the .s.sol omits) ---
  let [members] = (await ctx.client.readContract({
    ...hashConsensus,
    functionName: 'getFastLaneMembers',
  })) as [Hex[], bigint[]];
  if (members.length === 0) {
    [members] = (await ctx.client.readContract({
      ...hashConsensus,
      functionName: 'getMembers',
    })) as [Hex[], bigint[]];
  }
  if (members.length === 0) {
    throw new Error('@csm-lab/recipes: no consensus members to reach quorum');
  }

  // --- 5. Reach consensus from every member, then submit the report data as members[0] ---
  // Sequential is REQUIRED, not a missed parallelization: actAs impersonates one account at a time
  // (impersonate → write → stop), and impersonation is global fork state — running these in parallel
  // would interleave the start/stop of different members. Matches the source's sequential loop.
  for (const member of members) {
    // eslint-disable-next-line no-await-in-loop -- sequential by necessity (impersonation is global state)
    await actAs(ctx, member, (from) =>
      ctx.client.writeContract({
        ...hashConsensus,
        functionName: 'submitReport',
        args: [refSlot, hash, consensusVersion],
        account: from,
        chain: null,
      }),
    );
  }

  const contractVersion = (await ctx.client.readContract({
    ...oracle,
    functionName: 'getContractVersion',
  })) as bigint;
  await actAs(ctx, members[0]!, (from) =>
    ctx.client.writeContract({
      ...oracle,
      functionName: 'submitReportData',
      args: [data, contractVersion],
      account: from,
      chain: null,
    }),
  );

  return { submitted: true, refSlot, treeRoot: report.treeRoot, reportHash: hash, members };
}

/** keccak256(abi.encode(data)) — encode the 9-field struct as ONE tuple param (see REPORT_DATA_PARAMS). */
function reportHash(data: ReportData): Hex {
  return keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [data]));
}

/**
 * Mock strikes root: `keccak256(abi.encode("mock-strikes", refSlot))` — TWO top-level params
 * (`string`, `uint256`), NOT a tuple. Matches the source's `abi.encode(a, b)`.
 */
function strikesTreeRoot(refSlot: bigint): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('string, uint256'), ['mock-strikes', refSlot]),
  );
}
