import { Command } from 'commander';
import { isAddress, isHex, parseEther } from 'viem';
import type { Hex } from '@csm-lab/receipts';
import { connect, type Ctx } from '../context';

export interface OptionSpec {
  /** commander flag spec, e.g. '--operator-id <id>'. NEVER use a `--no-*` long name (negation). */
  flag: string;
  /** the recipe opts property this maps to, e.g. 'noId' (decoupled from the flag). */
  key: string;
  // Method form (params are checked bivariantly under strictFunctionTypes) so that a
  // narrow coercer like toBigInt(s: string) stays assignable. Single-value coercers
  // receive string; repeatable coercers receive string[].
  coerce(raw: string | string[]): unknown;
  required?: boolean;
  repeatable?: boolean;
  description?: string;
  /**
   * Force (true) or forbid (false) positional acceptance, overriding the default heuristic
   * (required && !repeatable). Set true to make an optional option positional, or to expose a
   * repeatable option as the trailing **variadic** positional — which then MUST be declared last.
   */
  positional?: boolean;
}

export interface RecipeCommand<O = Record<string, unknown>, R = unknown> {
  name: string;
  summary: string;
  options: OptionSpec[];
  // Method form (bivariant params) so descriptors with narrowed opts/result types —
  // e.g. run(ctx, o: { noId: bigint }) — remain assignable to RecipeCommand[].
  run(ctx: Ctx, opts: O): Promise<R> | R;
  report(result: R, opts: O): string[];
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

/** kebab name of a flag's long form, e.g. '--operator-id <id>' → 'operator-id'. */
export function flagName(flag: string): string {
  const long = flag.split(/[ ,]+/).find((t) => t.startsWith('--'));
  return (long ?? flag).replace(/^--/, '').replace(/<.*$/, '').trim();
}

/** commander's camelCased property name for a flag spec (mirrors commander's own rule). */
export function flagProp(flag: string): string {
  return flagName(flag).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === 'bigint' ? v.toString() : v;

/** anvil's default listen address — the fallback when neither --rpc-url nor RPC_URL is set. */
export const DEFAULT_RPC_URL = 'http://127.0.0.1:8545';

/** Run an async action; print thrown errors cleanly and exit non-zero. */
export function run(fn: () => Promise<void>): void {
  fn().catch((err: unknown) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

const collect = (v: string, acc: string[]): string[] => [...acc, v];

/** Whether an option is also accepted positionally — explicit `positional`, else required && !repeatable. */
const isPositional = (o: OptionSpec): boolean => o.positional ?? (!!o.required && !o.repeatable);

export function defineCommand(desc: RecipeCommand, connectImpl: typeof connect = connect): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  for (const o of desc.options) {
    if (o.repeatable) cmd.option(o.flag, o.description ?? '', collect, []);
    else cmd.option(o.flag, o.description ?? '');
  }
  // Selected options are ALSO accepted positionally, in declaration order:
  // `operator-info 0` == `operator-info --operator-id 0`. Default: every required,
  // non-repeatable option; an option can opt in/out with `positional`. A repeatable positional
  // is variadic (`[name...]`) and — per commander — must be the last argument. Declared
  // `[optional]` so the flag form still works; the loop below enforces required-ness + precedence.
  const positionals = desc.options.filter(isPositional);
  const variadicAt = positionals.findIndex((o) => o.repeatable);
  if (variadicAt >= 0 && variadicAt !== positionals.length - 1)
    throw new Error(`${desc.name}: a repeatable positional must be declared last (it is variadic)`);
  for (const o of positionals)
    cmd.argument(`[${flagName(o.flag)}${o.repeatable ? '...' : ''}]`, o.description ?? '');

  // commander calls the action with (...positionalValues, localOpts, command); we ignore the
  // leading values + local opts and read everything off `command` — robust to the arg count.
  cmd.action((...actionArgs: unknown[]) => {
    const command = actionArgs.at(-1) as Command;
    const positionalValues = command.processedArgs as (string | string[] | undefined)[];
    run(async () => {
      const g = command.optsWithGlobals() as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      for (const o of desc.options) {
        // a positional (when supplied) takes precedence over the flag for the same value. For a
        // variadic positional, an empty array means "none given" — fall back to the repeatable flag.
        const posIndex = positionals.indexOf(o);
        const posVal = posIndex >= 0 ? positionalValues[posIndex] : undefined;
        const posSupplied = o.repeatable
          ? Array.isArray(posVal) && posVal.length > 0
          : posVal != null;
        const raw = posSupplied ? posVal : g[flagProp(o.flag)];
        const empty = raw === undefined || (o.repeatable && (raw as string[]).length === 0);
        if (empty) {
          if (o.required) throw new Error(`missing required option ${o.flag.split(' ')[0]}`);
          continue;
        }
        opts[o.key] = o.coerce(raw as string | string[]);
      }
      const moduleName = desc.module ?? (g.module as 'csm' | 'cm' | undefined);
      if (!moduleName) throw new Error('set --module <csm|cm>');
      const rpcUrl = (g.rpcUrl as string | undefined) ?? process.env.RPC_URL ?? DEFAULT_RPC_URL;
      const clMockUrl = (g.clMockUrl as string | undefined) ?? process.env.CL_MOCK_URL;
      if (desc.needsClMock && !clMockUrl)
        throw new Error(`${desc.name} needs --cl-mock-url or CL_MOCK_URL`);

      const ctx = await connectImpl({ module: moduleName, rpcUrl, clMockUrl });
      const result = await desc.run(ctx, opts);
      if (g.json) {
        console.log(
          JSON.stringify(result === undefined ? { ok: true } : result, bigintReplacer, 2),
        );
      } else {
        for (const line of desc.report(result, opts)) console.log(line);
      }
    });
  });
  return cmd;
}
