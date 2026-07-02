import type { Hex } from '@sm-lab/receipts';
import { identity, toAddresses, type RecipeCommand } from '../define';
import { resolveGate } from '../../context';
import { setGateAddrs } from '../../recipes/set-gate';

const csmSelectorHelp = 'gate selector: ics (VettedGate) | idvtc (v3-only) | 0x… gate address';

export const csmCommands: RecipeCommand[] = [
  {
    name: 'set-gate',
    summary: 'build + install a gate address tree (pins to IPFS unless --cid)',
    module: 'csm',
    // Positional form leads with the selector, then the variadic addresses:
    //   `set-gate idvtc 0xabc… 0xdef…` == `set-gate --selector idvtc --address 0xabc… --address 0xdef…`
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        positional: true,
        description: `${csmSelectorHelp} (default: ics)`,
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
    summary: 'resolve a csm gate contract address by selector (read-only); prints the address',
    module: 'csm',
    options: [
      {
        flag: '--selector <name>',
        key: 'selector',
        coerce: identity,
        required: true,
        description: csmSelectorHelp,
      },
    ],
    run: (ctx, o: { selector: string }) => resolveGate(ctx, o.selector),
    report: (r: Hex, o: { selector: string }) => [`${o.selector} → ${r}`],
  },
];
