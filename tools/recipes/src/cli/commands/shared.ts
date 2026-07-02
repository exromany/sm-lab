import { formatEther } from 'viem';
import type { Hex } from '@sm-lab/receipts';
import {
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
import { unvet, exit } from '../../recipes/vetting';
import { increaseAllocatedBalance, topUpActiveKeys } from '../../recipes/topup';
import { slash, withdraw } from '../../recipes/validators';
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
import { getPubkey, getKeyBalance } from '../../recipes/reads';
import { warpBy, snapshot, revert } from '../../recipes/chain';

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
];
