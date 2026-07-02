import type { Hex } from '@sm-lab/receipts';
import {
  identity,
  toAddresses,
  toAddressValue,
  toBigInt,
  toHexValue,
  toPairs,
  type RecipeCommand,
} from '../define';
import {
  createCuratedOperator,
  createOperatorGroup,
  resetOperatorGroup,
  setBondCurveWeight,
  seedCm,
} from '../../cm';
import { resolveGate } from '../../context';
import { setGateAddrs } from '../../recipes/set-gate';

const operatorId = {
  flag: '--operator-id <id>',
  key: 'noId',
  coerce: toBigInt,
  required: true,
  description: 'node operator id (uint)',
};

const cmSelectorHelp =
  'gate selector: po|pto|pgo|do|eeo|iodc|iodcp, gate index 0-6, or 0x… address';

export const cmCommands: RecipeCommand[] = [
  {
    name: 'seed',
    summary: 'seed a realistic cm fork (3 operators, a group, keyed/deposited/topped-up)',
    module: 'cm',
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        description: `${cmSelectorHelp} (default: po)`,
      },
      {
        flag: '--seed <hex>',
        key: 'seed',
        coerce: toHexValue,
        description: 'deterministic seed (0x-hex); omit for fresh randomness',
      },
    ],
    run: (ctx, o: { selector?: string; seed?: Hex }) => seedCm(ctx, o),
    report: (r: { noIds: bigint[]; operators: Hex[] }) => [
      `seeded operators: ${r.noIds.join(', ')}`,
      `addresses: ${r.operators.join(', ')}`,
    ],
  },
  {
    name: 'create-curated-operator',
    summary:
      "create a curated node operator through a cm gate as --operator (the new operator's address); prints the new operator id",
    module: 'cm',
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        required: true,
        description: cmSelectorHelp,
      },
      { flag: '--operator <address>', key: 'operator', coerce: toAddressValue, required: true },
    ],
    run: (ctx, o: { selector: string; operator: Hex }) => createCuratedOperator(ctx, o),
    report: (r: { noId: bigint }) => [`created operator ${r.noId}`],
  },
  {
    name: 'create-operator-group',
    summary: 'create a MetaRegistry operator group (--pair noId:bps, must sum to 10000)',
    module: 'cm',
    options: [
      {
        flag: '--pair <noId:bps>',
        key: 'pairs',
        coerce: toPairs,
        repeatable: true,
        required: true,
      },
    ],
    run: (ctx, o: { pairs: [bigint, bigint][] }) => createOperatorGroup(ctx, o),
    report: (r: {
      subNodeOperators: { nodeOperatorId: bigint; share: number }[];
      resetGroupIds: bigint[];
    }) => [
      `group created: ${r.subNodeOperators.length} member(s)`,
      `members: ${r.subNodeOperators.map((s) => `${s.nodeOperatorId}@${s.share}bps`).join(', ')}`,
      ...(r.resetGroupIds.length ? [`reset prior groups: ${r.resetGroupIds.join(', ')}`] : []),
    ],
  },
  {
    name: 'reset-operator-group',
    summary: "reset an operator's group membership",
    module: 'cm',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => resetOperatorGroup(ctx, o),
    report: (_r, o: { noId: bigint }) => [`reset group for operator ${o.noId}`],
  },
  {
    name: 'set-bond-curve-weight',
    summary:
      'set the MetaRegistry bond-curve weight for a curve id (impersonates the role holder read from the contract)',
    module: 'cm',
    options: [
      { flag: '--curve-id <n>', key: 'curveId', coerce: toBigInt, required: true },
      { flag: '--weight <n>', key: 'weight', coerce: toBigInt, required: true },
    ],
    run: (ctx, o: { curveId: bigint; weight: bigint }) => setBondCurveWeight(ctx, o),
    report: (r: { curveId: bigint; weight: bigint }) => [`curve ${r.curveId} weight=${r.weight}`],
  },
  {
    name: 'set-gate',
    summary: 'build + install a gate address tree (pins to IPFS unless --cid)',
    module: 'cm',
    // Positional form leads with the selector, then the variadic addresses:
    //   `cm set-gate pto 0xabc… 0xdef…` == `cm set-gate --selector pto --address 0xabc… --address 0xdef…`
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        positional: true,
        description: `${cmSelectorHelp} (default: po)`,
      },
      {
        flag: '--address <addr>',
        key: 'addresses',
        coerce: toAddresses,
        repeatable: true,
        required: true,
        positional: true,
      },
      {
        flag: '--cid <cid>',
        key: 'cid',
        coerce: identity,
        description: 'skip IPFS pinning by supplying the CID — no running sm-ipfs needed',
      },
    ],
    run: (ctx, o: { addresses: Hex[]; selector?: string; cid?: string }) => setGateAddrs(ctx, o),
    report: (r: { treeRoot: Hex; treeCid: string }) => [
      `tree root: ${r.treeRoot}`,
      `tree CID:  ${r.treeCid}`,
    ],
  },
  {
    name: 'resolve-gate',
    summary: 'resolve a cm gate contract address by selector (read-only); prints the address',
    module: 'cm',
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        required: true,
        description: cmSelectorHelp,
      },
    ],
    run: (ctx, o: { selector: string }) => resolveGate(ctx, o.selector),
    report: (r: Hex, o: { selector: string }) => [`${o.selector} → ${r}`],
  },
];
