import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  numberToHex,
  parseAbiParameters,
} from 'viem';
import { stakingRouterAbi, vEBOAbi, type Hex } from '@sm-lab/receipts';
import { actAs, roleMember } from '../act-as';
import { contract, type Ctx } from '../context';
import { DEFAULT_ADMIN_ROLE } from '../roles';

export interface ExitRequestOptions {
  noId: bigint;
  keyIndex: bigint;
  /** CL validator index packed into the report. Defaults to 900000n (matches the just recipe). */
  validatorIndex?: bigint;
}

export interface ExitRequestResult {
  noId: bigint;
  keyIndex: bigint;
  validatorIndex: bigint;
  /** module id discovered in the StakingRouter. */
  moduleId: bigint;
  /** the report ref slot (= last consensus report refSlot + 1). */
  refSlot: bigint;
  /** keccak256(abi.encode(report)) submitted to VEBO. */
  reportHash: Hex;
  /** the 48-byte BLS pubkey exited. */
  pubkey: Hex;
}

/** DATA_FORMAT_LIST — the single supported VEBO exit-request data format. */
const DATA_FORMAT = 1n;
/** processing deadline offset — `block.timestamp + 1 days` (matches the source). */
const ONE_DAY = 86_400n;

/**
 * The VEBO `ReportData` struct as ONE tuple parameter (components in declaration order, verified
 * against `fixtures/receipts/src/abi/VEBO.ts`). `abi.encode(report)` for a single struct ==
 * ABI-encoding one tuple parameter — do NOT flatten into 5 top-level params (that drops the tuple
 * offset and changes the hash). Same trap `rewards.ts` documents for the fee-oracle report.
 */
const REPORT_DATA_PARAMS = parseAbiParameters(
  '(uint256 consensusVersion, uint256 refSlot, uint256 requestsCount, uint256 dataFormat, bytes data)',
);

/**
 * Request a single validator exit via the Validators Exit Bus Oracle. Port of
 * `NodeOperators.s.sol:_exitRequest`. Reads the key pubkey + discovers the module id, packs the
 * 64-byte exit request, then fakes VEBO consensus by impersonating the consensus contract
 * (`submitConsensusReport`) and submits the data as the VEBO admin (`grantRole` + `submitReportData`).
 *
 * Module-agnostic: `contract(ctx,'module')` picks CSModule/CuratedModule by `ctx.module`, and the
 * module-id scan matches that same address — no csm/cm branching.
 *
 * Deliberate divergences from the source (identical on-chain effect):
 * - reuses the VEBO admin as the `submitReportData` submitter (source grants a fresh address);
 *   `grantRole` is idempotent so re-granting the admin never reverts.
 * - scans ALL staking-module ids (source's `for (i=len-1; i>0; i--)` skips index 0).
 */
export async function exitRequest(ctx: Ctx, opts: ExitRequestOptions): Promise<ExitRequestResult> {
  const validatorIndex = opts.validatorIndex ?? 900_000n;
  const m = contract(ctx, 'module');
  const vebo = { address: ctx.addresses.vebo, abi: vEBOAbi } as const;

  // 1. key pubkey (48 bytes) + module id (scan the StakingRouter for this module's address)
  const pubkey = (await ctx.client.readContract({
    ...m,
    functionName: 'getSigningKeys',
    args: [opts.noId, opts.keyIndex, 1n],
  })) as Hex;
  const moduleId = await resolveModuleId(ctx, m.address);

  // 2. pack the single exit request: bytes3 moduleId | bytes5 noId | bytes8 validatorIndex | pubkey
  const data = encodePacked(
    ['bytes3', 'bytes5', 'bytes8', 'bytes'],
    [
      numberToHex(moduleId, { size: 3 }),
      numberToHex(opts.noId, { size: 5 }),
      numberToHex(validatorIndex, { size: 8 }),
      pubkey,
    ],
  );

  // 3. build the report (refSlot = last consensus report refSlot + 1) + its hash
  const consensusReport = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusReport',
  })) as readonly [Hex, bigint, bigint, boolean];
  const refSlot = consensusReport[1] + 1n;
  const consensusVersion = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusVersion',
  })) as bigint;
  const report = {
    consensusVersion,
    refSlot,
    requestsCount: 1n,
    dataFormat: DATA_FORMAT,
    data,
  };
  const reportHash = keccak256(encodeAbiParameters(REPORT_DATA_PARAMS, [report]));

  // 4. fake consensus: impersonate the consensus contract and submit the report hash directly
  const consensus = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getConsensusContract',
  })) as Hex;
  const deadline = (await ctx.client.getBlock()).timestamp + ONE_DAY;
  await actAs(ctx, consensus, (from) =>
    ctx.client.writeContract({
      ...vebo,
      functionName: 'submitConsensusReport',
      args: [reportHash, refSlot, deadline],
      account: from,
      chain: null,
    }),
  );

  // 5. submit the report data as the VEBO admin (granting itself SUBMIT_DATA_ROLE first)
  const admin = await roleMember(ctx, vebo, DEFAULT_ADMIN_ROLE);
  const submitRole = (await ctx.client.readContract({
    ...vebo,
    functionName: 'SUBMIT_DATA_ROLE',
  })) as Hex;
  const contractVersion = (await ctx.client.readContract({
    ...vebo,
    functionName: 'getContractVersion',
  })) as bigint;
  await actAs(ctx, admin, async (from) => {
    await ctx.client.writeContract({
      ...vebo,
      functionName: 'grantRole',
      args: [submitRole, admin],
      account: from,
      chain: null,
    });
    await ctx.client.writeContract({
      ...vebo,
      functionName: 'submitReportData',
      args: [report, contractVersion],
      account: from,
      chain: null,
    });
  });

  return {
    noId: opts.noId,
    keyIndex: opts.keyIndex,
    validatorIndex,
    moduleId,
    refSlot,
    reportHash,
    pubkey,
  };
}

/** Find the staking-module id whose registered address is `moduleAddress` (scans ALL ids). */
async function resolveModuleId(ctx: Ctx, moduleAddress: Hex): Promise<bigint> {
  const sr = { address: ctx.addresses.stakingRouter, abi: stakingRouterAbi } as const;
  const ids = (await ctx.client.readContract({
    ...sr,
    functionName: 'getStakingModuleIds',
  })) as bigint[];
  const mods = (await Promise.all(
    ids.map((id) =>
      ctx.client.readContract({ ...sr, functionName: 'getStakingModule', args: [id] }),
    ),
  )) as { stakingModuleAddress: Hex }[];
  const idx = mods.findIndex(
    (mod) => mod.stakingModuleAddress.toLowerCase() === moduleAddress.toLowerCase(),
  );
  if (idx === -1)
    throw new Error(`@sm-lab/recipes: module ${moduleAddress} not registered in the StakingRouter`);
  return ids[idx]!;
}
