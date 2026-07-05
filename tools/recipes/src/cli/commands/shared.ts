import { formatEther } from 'viem';
import type { Hex } from '@sm-lab/receipts';
import {
  bigintReplacer,
  identity,
  toAddressValue,
  toBigInt,
  toEth,
  toHexValue,
  toNumber,
  type RecipeCommand,
} from '../define';
import { addKeys } from '../../recipes/add-keys';
import { operatorInfo } from '../../recipes/operator-info';
import { deposit } from '../../recipes/deposit';
import { unvet, exit, removeKey } from '../../recipes/vetting';
import { increaseAllocatedBalance, topUpActiveKeys } from '../../recipes/topup';
import { slash, withdraw, activateKeys, reportBalance } from '../../recipes/validators';
import {
  reportPenalty,
  cancelPenalty,
  settlePenalty,
  compensatePenalty,
} from '../../recipes/penalties';
import { addBond, createBondDebt } from '../../recipes/bond';
import {
  proposeManager,
  confirmManager,
  proposeReward,
  confirmReward,
} from '../../recipes/address-changes';
import { makeRewards, submitRewards } from '../../recipes/rewards';
import { clActivate } from '../../recipes/cl-activate';
import {
  getPubkey,
  getKeyBalance,
  getCurveInfo,
  bondInfo,
  operatorKeys,
  keyBalances,
  operatorsCount,
  getLastOperator,
  getGateTree,
} from '../../recipes/reads';
import { warpBy, snapshot, revert, topUpAccount } from '../../recipes/chain';
import { setTargetLimit } from '../../recipes/target-limit';
import { pause, resume } from '../../recipes/pause';
import { exitRequest } from '../../recipes/exit-request';

const operatorId = {
  flag: '--operator-id <id>',
  key: 'noId',
  coerce: toBigInt,
  required: true,
  description: 'node operator id (uint)',
};
const keyIndex = {
  flag: '--key-index <i>',
  key: 'keyIndex',
  coerce: toBigInt,
  required: true,
  description: 'zero-based key index within the operator',
};
const seedHex = {
  flag: '--seed <hex>',
  key: 'seed',
  coerce: toHexValue,
  description: 'deterministic seed (0x-hex); omit for fresh randomness',
};
const cidEscape = (which: string) => ({
  coerce: identity,
  description: `skip IPFS pinning by supplying the ${which} CID — no running sm-ipfs needed`,
});

export const sharedCommands: RecipeCommand[] = [
  {
    name: 'add-keys',
    summary: 'add N fresh validator keys to an operator (pays bond, as manager)',
    options: [
      operatorId,
      { flag: '--count <n>', key: 'count', coerce: toNumber, required: true },
      seedHex,
    ],
    run: (ctx, o: { noId: bigint; count: number; seed?: Hex }) => addKeys(ctx, o),
    report: (r: { publicKeys: Hex[] }, o: { noId: bigint; count: number }) => [
      `operator ${o.noId}: +${o.count} keys`,
      `pubkeys: ${r.publicKeys.join(', ')}`,
    ],
  },
  {
    name: 'operator-info',
    summary:
      "read a node operator's on-chain record (addresses + key counts); one field per line, --json for the raw object",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => operatorInfo(ctx, o),
    report: (r: Record<string, unknown>, o: { noId: bigint }) => [
      `operator ${o.noId}:`,
      ...Object.entries(r).map(([k, v]) => `  ${k}: ${String(v)}`),
    ],
  },
  {
    name: 'deposit',
    summary: 'deposit N depositable keys (as the StakingRouter)',
    options: [{ flag: '--count <n>', key: 'count', coerce: toBigInt, required: true }],
    run: (ctx, o: { count: bigint }) => deposit(ctx, o),
    report: (r: { deposited: bigint }) => [`deposited: ${r.deposited}`],
  },
  {
    name: 'unvet',
    summary: 'set an operator vetted-keys count down (as the StakingRouter)',
    options: [
      operatorId,
      { flag: '--vetted-keys <n>', key: 'vettedKeys', coerce: toBigInt, required: true },
    ],
    run: (ctx, o: { noId: bigint; vettedKeys: bigint }) => unvet(ctx, o),
    report: (_r, o: { noId: bigint; vettedKeys: bigint }) => [
      `operator ${o.noId}: vetted=${o.vettedKeys}`,
    ],
  },
  {
    name: 'exit',
    summary: 'report exited keys for an operator (as the StakingRouter)',
    options: [
      operatorId,
      { flag: '--exited-keys <n>', key: 'exitedKeys', coerce: toBigInt, required: true },
    ],
    run: (ctx, o: { noId: bigint; exitedKeys: bigint }) => exit(ctx, o),
    report: (_r, o: { noId: bigint; exitedKeys: bigint }) => [
      `operator ${o.noId}: exited=${o.exitedKeys}`,
    ],
  },
  {
    name: 'exit-request',
    summary:
      'request a validator exit via VEBO (impersonates the consensus contract + a submitter)',
    options: [
      operatorId,
      keyIndex,
      {
        flag: '--validator-index <n>',
        key: 'validatorIndex',
        coerce: toBigInt,
        description: 'CL validator index to pack into the report (default 900000)',
      },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; validatorIndex?: bigint }) =>
      exitRequest(ctx, o),
    report: (
      r: { moduleId: bigint; refSlot: bigint; reportHash: string; clStatus?: string },
      o: { noId: bigint; keyIndex: bigint },
    ) => [
      `operator ${o.noId} key ${o.keyIndex}: exit requested (module ${r.moduleId}, refSlot ${r.refSlot})`,
      `reportHash ${r.reportHash}`,
      ...(r.clStatus ? [`cl-mock: validator marked ${r.clStatus}`] : []),
    ],
  },
  {
    name: 'increase-allocated-balance',
    summary: "top up one deposited key's allocated balance (ETH)",
    options: [
      operatorId,
      keyIndex,
      { flag: '--amount <eth>', key: 'amountWei', coerce: toEth, required: true },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; amountWei: bigint }) =>
      increaseAllocatedBalance(ctx, o),
    report: (r: { amountWei: bigint }) => [`+${formatEther(r.amountWei)} ETH allocated`],
  },
  {
    name: 'top-up-active-keys',
    summary:
      'allocate deposit balance to every active key of an operator, in key-index order (TopUpQueueOps FIFO), as the StakingRouter; capped at 2016 ETH per key',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => topUpActiveKeys(ctx, o),
    report: (r: { toppedUp: number }) => [`topped up ${r.toppedUp} key(s)`],
  },
  {
    name: 'slash',
    summary: 'slash a validator key (Verifier-gated)',
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => slash(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint }) => [
      `slashed operator ${o.noId} key ${o.keyIndex}`,
    ],
  },
  {
    name: 'withdraw',
    summary: 'report a withdrawn validator (Verifier-gated); balances in ETH',
    options: [
      operatorId,
      keyIndex,
      { flag: '--exit-balance <eth>', key: 'exitBalance', coerce: toEth, required: true },
      { flag: '--slashing-penalty <eth>', key: 'slashingPenalty', coerce: toEth },
    ],
    run: (
      ctx,
      o: { noId: bigint; keyIndex: bigint; exitBalance: bigint; slashingPenalty?: bigint },
    ) => withdraw(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint }) => [
      `withdrew operator ${o.noId} key ${o.keyIndex}`,
    ],
  },
  {
    name: 'report-penalty',
    summary: 'report a general delayed penalty (ETH amount)',
    options: [
      operatorId,
      { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true },
      { flag: '--penalty-type <hex>', key: 'penaltyType', coerce: toHexValue },
      { flag: '--details <text>', key: 'details', coerce: identity },
    ],
    run: (ctx, o: { noId: bigint; amount: bigint; penaltyType?: Hex; details?: string }) =>
      reportPenalty(ctx, o),
    report: (_r, o: { noId: bigint; amount: bigint }) => [
      `reported penalty ${formatEther(o.amount)} ETH on operator ${o.noId}`,
    ],
  },
  {
    name: 'cancel-penalty',
    summary: 'cancel a reported general delayed penalty (ETH amount)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => cancelPenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`cancelled penalty on operator ${o.noId}`],
  },
  {
    name: 'settle-penalty',
    summary: "settle an operator's general delayed penalty (optional ETH cap)",
    options: [operatorId, { flag: '--max-amount <eth>', key: 'maxAmount', coerce: toEth }],
    run: (ctx, o: { noId: bigint; maxAmount?: bigint }) => settlePenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`settled penalty on operator ${o.noId}`],
  },
  {
    name: 'compensate-penalty',
    summary: "compensate (pay off) an operator's penalty (as manager)",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => compensatePenalty(ctx, o),
    report: (_r, o: { noId: bigint }) => [`compensated penalty on operator ${o.noId}`],
  },
  {
    name: 'add-bond',
    summary: 'add bond to an operator (ETH)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => addBond(ctx, o),
    report: (_r, o: { noId: bigint; amount: bigint }) => [
      `added ${formatEther(o.amount)} ETH bond to operator ${o.noId}`,
    ],
  },
  {
    name: 'create-bond-debt',
    summary: 'create a bond debt by penalizing an operator (ETH)',
    options: [operatorId, { flag: '--amount <eth>', key: 'amount', coerce: toEth, required: true }],
    run: (ctx, o: { noId: bigint; amount: bigint }) => createBondDebt(ctx, o),
    report: (r: { penaltyCovered: boolean }, o: { noId: bigint }) => [
      `operator ${o.noId}: debt created (penaltyCovered=${r.penaltyCovered})`,
    ],
  },
  {
    name: 'propose-manager',
    summary: 'propose a new manager address (as current manager)',
    options: [
      operatorId,
      { flag: '--proposed <address>', key: 'proposed', coerce: toAddressValue, required: true },
    ],
    run: (ctx, o: { noId: bigint; proposed: Hex }) => proposeManager(ctx, o),
    report: (_r, o: { noId: bigint; proposed: Hex }) => [
      `operator ${o.noId}: proposed manager ${o.proposed}`,
    ],
  },
  {
    name: 'confirm-manager',
    summary: 'confirm the proposed manager address (as proposed manager)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => confirmManager(ctx, o),
    report: (_r, o: { noId: bigint }) => [`operator ${o.noId}: manager confirmed`],
  },
  {
    name: 'propose-reward',
    summary: 'propose a new reward address (as current manager)',
    options: [
      operatorId,
      { flag: '--proposed <address>', key: 'proposed', coerce: toAddressValue, required: true },
    ],
    run: (ctx, o: { noId: bigint; proposed: Hex }) => proposeReward(ctx, o),
    report: (_r, o: { noId: bigint; proposed: Hex }) => [
      `operator ${o.noId}: proposed reward ${o.proposed}`,
    ],
  },
  {
    name: 'confirm-reward',
    summary: 'confirm the proposed reward address (as proposed reward addr)',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => confirmReward(ctx, o),
    report: (_r, o: { noId: bigint }) => [`operator ${o.noId}: reward confirmed`],
  },
  {
    name: 'make-rewards',
    summary: 'build the cumulative rewards tree + pin to IPFS (no submit)',
    options: [
      seedHex,
      { flag: '--tree-cid <cid>', key: 'treeCid', ...cidEscape('tree') },
      { flag: '--log-cid <cid>', key: 'logCid', ...cidEscape('report-log') },
    ],
    run: (ctx, o: { seed?: Hex; treeCid?: string; logCid?: string }) => makeRewards(ctx, o),
    report: (r: { treeRoot: Hex; treeCid: string; logCid: string; distributed: bigint }) => [
      `tree root: ${r.treeRoot}`,
      `tree CID:  ${r.treeCid || '(none)'}`,
      `log CID:   ${r.logCid || '(none)'}`,
      `distributed: ${formatEther(r.distributed)} ETH`,
    ],
  },
  {
    name: 'submit-rewards',
    summary: 'build AND submit a rewards report (warps to the next frame)',
    options: [
      seedHex,
      { flag: '--tree-cid <cid>', key: 'treeCid', ...cidEscape('tree') },
      { flag: '--log-cid <cid>', key: 'logCid', ...cidEscape('report-log') },
    ],
    run: async (ctx, o: { seed?: Hex; treeCid?: string; logCid?: string }) =>
      submitRewards(ctx, await makeRewards(ctx, o)),
    report: (r: { submitted: boolean; refSlot?: bigint; reportHash?: Hex }) =>
      r.submitted
        ? [`submitted at refSlot ${r.refSlot}`, `reportHash: ${r.reportHash}`]
        : ['skipped: empty report (zero root)'],
  },
  {
    name: 'cl-activate',
    summary:
      'mark a key active_ongoing on a running cl-mock (requires --cl-mock-url or CL_MOCK_URL)',
    needsClMock: true,
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => clActivate(ctx, o),
    report: (r: { pubkey: Hex; status: string; effectiveBalanceGwei: bigint }) => [
      `${r.pubkey}: ${r.status} @ ${r.effectiveBalanceGwei} gwei`,
    ],
  },
  {
    name: 'get-pubkey',
    summary: "read a key's pubkey",
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => getPubkey(ctx, o),
    report: (r: Hex) => [r],
  },
  {
    name: 'get-key-balance',
    summary: "read a key's allocated balance",
    options: [operatorId, keyIndex],
    run: (ctx, o: { noId: bigint; keyIndex: bigint }) => getKeyBalance(ctx, o),
    report: (r: bigint) => [`${formatEther(r)} ETH (${r} wei)`],
  },
  {
    name: 'warp',
    summary: 'advance the fork clock by N seconds',
    options: [{ flag: '--by <seconds>', key: 'by', coerce: toBigInt, required: true }],
    run: (ctx, o: { by: bigint }) => warpBy(ctx, o.by),
    report: (_r, o: { by: bigint }) => [`warped by ${o.by} seconds`],
  },
  {
    name: 'snapshot',
    summary: 'take an EVM snapshot, print its id',
    options: [],
    run: (ctx) => snapshot(ctx),
    report: (r: Hex) => [`snapshot id: ${r}`],
  },
  {
    name: 'revert',
    summary: 'revert the fork to a snapshot id',
    options: [{ flag: '--id <hex>', key: 'id', coerce: toHexValue, required: true }],
    run: (ctx, o: { id: Hex }) => revert(ctx, o.id),
    report: (_r, o: { id: Hex }) => [`reverted to ${o.id}`],
  },
  {
    name: 'set-target-limit',
    summary:
      "set an operator's target validator limit (as the StakingRouter); mode 0=off, 1=soft, 2=forced",
    options: [
      operatorId,
      {
        flag: '--mode <0|1|2>',
        key: 'mode',
        coerce: toNumber,
        required: true,
        description: '0=off, 1=soft, 2=forced',
      },
      {
        flag: '--limit <n>',
        key: 'limit',
        coerce: toBigInt,
        description: 'target limit (ignored for mode 0; default 0)',
      },
    ],
    run: (ctx, o: { noId: bigint; mode: number; limit?: bigint }) => setTargetLimit(ctx, o),
    report: (r: { noId: bigint; mode: number; limit: bigint }) => [
      `operator ${r.noId}: targetLimitMode=${r.mode}, limit=${r.limit}`,
    ],
  },
  {
    name: 'remove-key',
    summary: 'remove key(s) from an operator starting at an index (as manager)',
    options: [
      operatorId,
      keyIndex,
      {
        flag: '--count <n>',
        key: 'count',
        coerce: toBigInt,
        description: 'number of keys to remove (default 1)',
      },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; count?: bigint }) => removeKey(ctx, o),
    report: (_r, o: { noId: bigint; keyIndex: bigint; count?: bigint }) => [
      `operator ${o.noId}: removed ${o.count ?? 1n} key(s) from index ${o.keyIndex}`,
    ],
  },
  {
    name: 'get-curve-info',
    summary: 'read a bond curve by id (read-only)',
    options: [
      {
        flag: '--curve-id <n>',
        key: 'curveId',
        coerce: toBigInt,
        required: true,
        description: 'bond curve id (uint)',
      },
    ],
    run: (ctx, o: { curveId: bigint }) => getCurveInfo(ctx, o),
    report: (r: unknown) => [JSON.stringify(r, bigintReplacer, 2)],
  },
  {
    name: 'pause',
    summary:
      'pause a target: module | accounting | gate selector (grants PAUSE_ROLE + pauseFor max; idempotent)',
    options: [
      {
        flag: '--target <name>',
        key: 'target',
        coerce: identity,
        required: true,
        positional: true,
        description: 'module | accounting | gate selector (ics/idvtc/po…iodcp/index/0x…)',
      },
    ],
    run: (ctx, o: { target: string }) => pause(ctx, o),
    report: (r: { target: string; address: Hex; paused: boolean }) => [
      `${r.target} (${r.address}): paused=${r.paused}`,
    ],
  },
  {
    name: 'resume',
    summary:
      'resume a target: module | accounting | gate selector (grants RESUME_ROLE + resume; idempotent)',
    options: [
      {
        flag: '--target <name>',
        key: 'target',
        coerce: identity,
        required: true,
        positional: true,
        description: 'module | accounting | gate selector (ics/idvtc/po…iodcp/index/0x…)',
      },
    ],
    run: (ctx, o: { target: string }) => resume(ctx, o),
    report: (r: { target: string; address: Hex; paused: boolean }) => [
      `${r.target} (${r.address}): paused=${r.paused}`,
    ],
  },
  {
    name: 'activate-keys',
    summary: 'activate N deposited keys on-chain (report 32 ETH + 1 gwei each, Verifier-gated)',
    options: [operatorId, { flag: '--count <n>', key: 'count', coerce: toNumber, required: true }],
    run: (ctx, o: { noId: bigint; count: number }) => activateKeys(ctx, o),
    report: (r: { activated: number }) => [`activated ${r.activated} key(s)`],
  },
  {
    name: 'report-balance',
    summary: "report a key's CL balance on-chain (ETH, Verifier-gated)",
    options: [
      operatorId,
      keyIndex,
      { flag: '--balance <eth>', key: 'balanceWei', coerce: toEth, required: true },
    ],
    run: (ctx, o: { noId: bigint; keyIndex: bigint; balanceWei: bigint }) => reportBalance(ctx, o),
    report: (r: { noId: bigint; keyIndex: bigint; balanceWei: bigint }) => [
      `operator ${r.noId} key ${r.keyIndex}: reported ${formatEther(r.balanceWei)} ETH`,
    ],
  },
  {
    name: 'topup',
    summary: 'fund an account by setting its balance (anvil_setBalance; default 100 ETH)',
    options: [
      {
        flag: '--address <addr>',
        key: 'address',
        coerce: toAddressValue,
        required: true,
        positional: true,
      },
      {
        flag: '--amount <eth>',
        key: 'amountWei',
        coerce: toEth,
        description: 'ETH to set (default 100)',
      },
    ],
    run: (ctx, o: { address: Hex; amountWei?: bigint }) => topUpAccount(ctx, o),
    report: (r: { address: Hex; amountWei: bigint }) => [
      `${r.address}: balance set to ${formatEther(r.amountWei)} ETH`,
    ],
  },
  {
    name: 'bond-info',
    summary:
      "read an operator's bond summary (read-only); one field per line, --json for the object",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => bondInfo(ctx, o),
    report: (r: Record<string, bigint>, o: { noId: bigint }) => [
      `operator ${o.noId}:`,
      ...Object.entries(r).map(([k, v]) => `  ${k}: ${v}`),
    ],
  },
  {
    name: 'operator-keys',
    summary: "read all of an operator's pubkeys (read-only)",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => operatorKeys(ctx, o),
    report: (r: Hex[]) => (r.length ? r : ['(no keys)']),
  },
  {
    name: 'key-balances',
    summary: "read all of an operator's deposited-key allocated balances (read-only)",
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => keyBalances(ctx, o),
    report: (r: bigint[]) =>
      r.length ? r.map((b, i) => `  key ${i}: ${formatEther(b)} ETH`) : ['(no deposited keys)'],
  },
  {
    name: 'operators-count',
    summary: 'read the module operator count (read-only)',
    options: [],
    run: (ctx) => operatorsCount(ctx),
    report: (r: bigint) => [`${r}`],
  },
  {
    name: 'get-last-operator',
    summary: 'read the highest operator id, count - 1 (read-only)',
    options: [],
    run: (ctx) => getLastOperator(ctx),
    report: (r: bigint) => [`${r}`],
  },
  {
    name: 'get-gate-tree',
    summary: "read a gate's current merkle tree root + cid by selector (read-only)",
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        required: true,
        positional: true,
        description: 'gate selector (ics/idvtc for csm; po…iodcp for cm; 0x…)',
      },
    ],
    run: (ctx, o: { selector: string }) => getGateTree(ctx, o),
    report: (r: { selector: string; address: Hex; treeRoot: Hex; treeCid: string }) => [
      `${r.selector} → ${r.address}`,
      `root: ${r.treeRoot}`,
      `cid:  ${r.treeCid}`,
    ],
  },
];
