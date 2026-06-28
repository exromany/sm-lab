import type { Hex } from '@csm-lab/receipts';
import { identity, toAddresses, type RecipeCommand } from '../define';
import { resolveGate } from '../../context';
import { setGateAddrs } from '../../csm';

export const csmCommands: RecipeCommand[] = [
  {
    name: 'set-gate',
    summary: 'build + install a gate address tree (pins to IPFS unless --cid)',
    module: 'csm',
    options: [
      { flag: '--address <addr>', key: 'addresses', coerce: toAddresses, repeatable: true, required: true },
      { flag: '--selector <name>', key: 'selector', coerce: identity },
      { flag: '--cid <cid>', key: 'cid', coerce: identity },
    ],
    run: (ctx, o: { addresses: Hex[]; selector?: 'ics'; cid?: string }) => setGateAddrs(ctx, o),
    report: (r: { treeRoot: Hex; treeCid: string }) => [`tree root: ${r.treeRoot}`, `tree CID:  ${r.treeCid}`],
  },
  {
    name: 'resolve-gate',
    summary: 'resolve a gate address by selector (read-only)',
    module: 'csm',
    options: [{ flag: '--selector <name>', key: 'selector', coerce: identity, required: true }],
    run: (ctx, o: { selector: string }) => resolveGate(ctx, o.selector),
    report: (r: Hex, o: { selector: string }) => [`${o.selector} → ${r}`],
  },
];
