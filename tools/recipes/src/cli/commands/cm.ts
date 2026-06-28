import type { Hex } from '@csm-lab/receipts';
import {
  identity,
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

const operatorId = { flag: '--operator-id <id>', key: 'noId', coerce: toBigInt, required: true };

export const cmCommands: RecipeCommand[] = [
  {
    name: 'seed',
    summary: 'seed a realistic cm fork (3 operators, a group, keyed/deposited/topped-up)',
    module: 'cm',
    options: [
      { flag: '--selector <name>', key: 'selector', coerce: identity },
      { flag: '--seed <hex>', key: 'seed', coerce: toHexValue },
    ],
    run: (ctx, o: { selector?: string; seed?: Hex }) => seedCm(ctx, o),
    report: (r: { noIds: bigint[]; operators: Hex[] }) => [
      `seeded operators: ${r.noIds.join(', ')}`,
      `addresses: ${r.operators.join(', ')}`,
    ],
  },
  {
    name: 'create-curated-operator',
    summary: 'create a curated operator via a cm gate',
    module: 'cm',
    options: [
      { flag: '--selector <name>', key: 'selector', coerce: identity, required: true },
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
    summary: 'reset an operator’s group membership',
    module: 'cm',
    options: [operatorId],
    run: (ctx, o: { noId: bigint }) => resetOperatorGroup(ctx, o),
    report: (_r, o: { noId: bigint }) => [`reset group for operator ${o.noId}`],
  },
  {
    name: 'set-bond-curve-weight',
    summary: 'set a bond curve weight',
    module: 'cm',
    options: [
      { flag: '--curve-id <n>', key: 'curveId', coerce: toBigInt, required: true },
      { flag: '--weight <n>', key: 'weight', coerce: toBigInt, required: true },
    ],
    run: (ctx, o: { curveId: bigint; weight: bigint }) => setBondCurveWeight(ctx, o),
    report: (r: { curveId: bigint; weight: bigint }) => [`curve ${r.curveId} weight=${r.weight}`],
  },
];
