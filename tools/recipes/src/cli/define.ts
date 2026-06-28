// tools/recipes/src/cli/define.ts
import { Command } from 'commander';
import { isAddress, isHex, parseEther } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { connect, type Ctx } from '../context';

export interface OptionSpec {
  /** commander flag spec, e.g. '--operator-id <id>'. NEVER use a `--no-*` long name (negation). */
  flag: string;
  /** the recipe opts property this maps to, e.g. 'noId' (decoupled from the flag). */
  key: string;
  // Single-value coercers receive string; repeatable coercers receive string[].
  coerce: (raw: any) => unknown;
  required?: boolean;
  repeatable?: boolean;
  description?: string;
}

export interface RecipeCommand<O = Record<string, unknown>, R = unknown> {
  name: string;
  summary: string;
  options: OptionSpec[];
  run: (ctx: Ctx, opts: O) => Promise<R> | R;
  report: (result: R, opts: O) => string[];
  /** cm/csm-only commands set this; it forces ctx.module and overrides global --module. */
  module?: 'cm' | 'csm';
  needsClMock?: boolean;
}

// --- coercers (string → typed) ---
export function toBigInt(s: string): bigint {
  return BigInt(s); // throws SyntaxError on garbage
}
export function toNumber(s: string): number {
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`not a number: ${s}`);
  return n;
}
/** ETH (decimal string) → wei bigint. String-based; 1 wei → 1n. */
export function toEth(s: string): bigint {
  return parseEther(s);
}
export function toHexValue(s: string): Hex {
  if (!isHex(s)) throw new Error(`not a 0x-hex value: ${s}`);
  return s;
}
export function toAddressValue(s: string): Hex {
  if (!isAddress(s)) throw new Error(`not an address: ${s}`);
  return s as Hex;
}
export function identity(s: string): string {
  return s;
}
/** Repeatable '--pair <noId:bps>' → [bigint, bigint][]. */
export function toPairs(raw: string[]): [bigint, bigint][] {
  return raw.map((p) => {
    const [a, b] = p.split(':');
    if (a === undefined || b === undefined) throw new Error(`bad pair "${p}", want noId:bps`);
    return [BigInt(a), BigInt(b)] as [bigint, bigint];
  });
}
/** Repeatable '--address <addr>' → Hex[]. */
export function toAddresses(raw: string[]): Hex[] {
  return raw.map(toAddressValue);
}

/** commander's camelCased property name for a flag spec (mirrors commander's own rule). */
export function flagProp(flag: string): string {
  const long = flag.split(/[ ,]+/).find((t) => t.startsWith('--'));
  const name = (long ?? flag).replace(/^--/, '').replace(/<.*$/, '').trim();
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

/** Run an async action; print thrown errors cleanly and exit non-zero. */
export function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function defineCommand(desc: RecipeCommand<any, any>, connectImpl: typeof connect = connect): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  for (const o of desc.options) {
    if (o.repeatable) cmd.option(o.flag, o.description ?? '', collect, []);
    else cmd.option(o.flag, o.description ?? '');
  }
  cmd.action((_local: unknown, command: Command) => {
    run(async () => {
      const g = command.optsWithGlobals() as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      for (const o of desc.options) {
        const raw = g[flagProp(o.flag)];
        const empty = raw === undefined || (o.repeatable && (raw as string[]).length === 0);
        if (empty) {
          if (o.required) throw new Error(`missing required option ${o.flag.split(' ')[0]}`);
          continue;
        }
        opts[o.key] = o.coerce(raw as string | string[]);
      }
      const moduleName = desc.module ?? (g.module as 'csm' | 'cm' | undefined);
      if (!moduleName) throw new Error('set --module <csm|cm>');
      const rpcUrl = (g.rpcUrl as string | undefined) ?? process.env.RPC_URL;
      if (!rpcUrl) throw new Error('set --rpc-url or RPC_URL');
      const clMockUrl = (g.clMockUrl as string | undefined) ?? process.env.CL_MOCK_URL;
      if (desc.needsClMock && !clMockUrl)
        throw new Error(`${desc.name} needs --cl-mock-url or CL_MOCK_URL`);

      const ctx = await connectImpl({ module: moduleName, rpcUrl, clMockUrl });
      const result = await desc.run(ctx, opts);
      if (g.json) {
        console.log(JSON.stringify(result === undefined ? { ok: true } : result, bigintReplacer, 2));
      } else {
        for (const line of desc.report(result, opts)) console.log(line);
      }
    });
  });
  return cmd;
}
