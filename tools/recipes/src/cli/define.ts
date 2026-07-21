import { Command } from 'commander';
import { isAddress, isHex, parseEther } from 'viem';
import type { Hex } from '@sm-lab/receipts';
import { connect, type Ctx } from '../context';

export interface OptionSpec {
  /** commander flag spec, e.g. '--operator-id <id>'. NEVER use a `--no-*` long name (negation). */
  flag: string;
  /** the recipe opts property this maps to, e.g. 'noId' (decoupled from the flag). */
  key: string;
  // Method form (params are checked bivariantly under strictFunctionTypes) so that a
  // narrow coercer like toBigInt(s: string) stays assignable. Single-value coercers
  // receive string; repeatable coercers receive string[]. OPTIONAL: a flag spec without
  // a `<value>` placeholder is a boolean switch — commander stores `true` and coercion
  // is bypassed, so switches omit `coerce` entirely.
  coerce?(raw: string | string[]): unknown;
  required?: boolean;
  repeatable?: boolean;
  description?: string;
  /**
   * Force (true) or forbid (false) positional acceptance, overriding the default heuristic
   * (required && !repeatable). Set true to make an optional option positional, or to expose a
   * repeatable option as the trailing **variadic** positional — which then MUST be declared last.
   */
  positional?: boolean;
  /**
   * Positional-token predicate. When ANY positional of a command declares `match`, supplied
   * positional tokens are redistributed: each token (in CLI order) fills the FIRST unfilled
   * positional whose predicate accepts it (no predicate = accepts anything); a token nobody
   * accepts is an error. Makes two optional positionals order-free (`cmd idvtc 10` == `cmd 10
   * idvtc`). Incompatible with a variadic (repeatable) positional.
   */
  match?(token: string): boolean;
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

// Help fallback derived from the coercer's contract, so a spec without a `description`
// never renders as a bare flag in --help. Keyed by identity — descriptors reference the
// exported coercers directly. `identity` stays undescribed (nothing can be inferred).
const COERCER_HELP: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  [toEth, 'amount in ETH (decimal, 1-wei exact)'],
  [toBigInt, 'unsigned integer'],
  [toNumber, 'number'],
  [toHexValue, '0x-prefixed hex value'],
  [toAddressValue, '0x… address'],
  [toAddresses, '0x… address'],
  [toPairs, 'noId:bps pair'],
]);

const optionHelp = (o: OptionSpec): string => o.description ?? COERCER_HELP.get(o.coerce) ?? '';

/** Whether an option is also accepted positionally — explicit `positional`, else required && !repeatable. */
const isPositional = (o: OptionSpec): boolean => o.positional ?? (!!o.required && !o.repeatable);

export function defineCommand(desc: RecipeCommand, connectImpl: typeof connect = connect): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  for (const o of desc.options) {
    if (o.repeatable) cmd.option(o.flag, optionHelp(o), collect, []);
    else cmd.option(o.flag, optionHelp(o));
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
  if (positionals.some((o) => o.match) && variadicAt >= 0)
    throw new Error(
      `${desc.name}: match-based positionals cannot combine with a variadic positional`,
    );
  for (const o of positionals)
    cmd.argument(`[${flagName(o.flag)}${o.repeatable ? '...' : ''}]`, optionHelp(o));
  // The positional-alias feature is invisible in commander's generated usage ("[options]"),
  // so surface the accepted order explicitly in every command's help.
  if (positionals.length > 0) {
    const order = positionals.map((o) => flagName(o.flag) + (o.repeatable ? '...' : '')).join(', ');
    // `match`-based positionals are order-free (and, per the redistribution rule, effectively
    // optional) — the "Required … in this order" wording would misstate both properties.
    const helpLine = positionals.some((o) => o.match)
      ? `\nOptions may be passed positionally (any order): ${order}`
      : `\nRequired options may be passed positionally in this order: ${order}`;
    cmd.addHelpText('after', helpLine);
  }

  // commander calls the action with (...positionalValues, localOpts, command); we ignore the
  // leading values + local opts and read everything off `command` — robust to the arg count.
  cmd.action((...actionArgs: unknown[]) => {
    const command = actionArgs.at(-1) as Command;
    const positionalValues = command.processedArgs as (string | string[] | undefined)[];
    run(async () => {
      const g = command.optsWithGlobals() as Record<string, unknown>;
      const opts: Record<string, unknown> = {};
      // Positional-value assignment: strict declaration order by default; when any positional
      // declares `match`, redistribute tokens by predicate (first unfilled acceptor wins).
      const assigned = new Map<OptionSpec, string | string[] | undefined>();
      if (positionals.some((p) => p.match)) {
        const tokens = positionalValues.filter((v): v is string => typeof v === 'string');
        for (const token of tokens) {
          const slot = positionals.find((p) => !assigned.has(p) && (p.match?.(token) ?? true));
          if (!slot) throw new Error(`unrecognized positional "${token}"`);
          assigned.set(slot, token);
        }
      } else {
        positionals.forEach((p, i) => assigned.set(p, positionalValues[i]));
      }
      for (const o of desc.options) {
        // a positional (when supplied) takes precedence over the flag for the same value. For a
        // variadic positional, an empty array means "none given" — fall back to the repeatable flag.
        const posVal = assigned.get(o);
        const posSupplied = o.repeatable
          ? Array.isArray(posVal) && posVal.length > 0
          : posVal != null;
        const raw = posSupplied ? posVal : g[flagProp(o.flag)];
        const empty = raw === undefined || (o.repeatable && (raw as string[]).length === 0);
        if (empty) {
          if (o.required) throw new Error(`missing required option ${o.flag.split(' ')[0]}`);
          continue;
        }
        // A boolean switch's raw is commander's stored `true` — no coercion applies.
        opts[o.key] =
          typeof raw === 'boolean' ? raw : o.coerce ? o.coerce(raw as string | string[]) : raw;
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
