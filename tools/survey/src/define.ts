import { Command } from 'commander';
import type { PrismaClient } from './db';
import { assertAddress } from './gen';

export type OptionSpec = {
  flag: string;
  desc: string;
  coerce?: (raw: string, prev?: unknown) => unknown;
  repeatable?: boolean;
  kv?: boolean;
};

export type SeedCommand = {
  group: string;
  name: string;
  summary: string;
  argument?: { name: string; desc: string; prop: string };
  options: OptionSpec[];
  run(prisma: PrismaClient, args: Record<string, unknown>): Promise<unknown>;
};

const STATUSES = ['REVIEW', 'APPROVED', 'REJECTED'] as const;
export type StatusName = (typeof STATUSES)[number];

export function toAddress(raw: string): string {
  return assertAddress(raw);
}

export function toStatus(raw: string): StatusName {
  const upper = raw.toUpperCase();
  if (!STATUSES.includes(upper as StatusName)) {
    throw new Error(`Invalid status '${raw}' (expected review|approved|rejected)`);
  }
  return upper as StatusName;
}

export function toInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, got '${raw}'`);
  return n;
}

export function toKv(raw: string, prev?: Record<string, string>): Record<string, string> {
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new Error(`Expected field=value, got '${raw}'`);
  const acc = prev ?? {};
  acc[raw.slice(0, eq)] = raw.slice(eq + 1);
  return acc;
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function printResult(result: unknown, json: boolean): void {
  const value = result === undefined ? { ok: true } : result;
  console.log(typeof value === 'string' && !json ? value : JSON.stringify(value, jsonReplacer, 2));
}

export function defineCommand(desc: SeedCommand, getPrisma: () => PrismaClient): Command {
  const cmd = new Command(desc.name).description(desc.summary);
  if (desc.argument) cmd.argument(`<${desc.argument.name}>`, desc.argument.desc);
  for (const opt of desc.options) {
    if (opt.kv || opt.repeatable) {
      cmd.option(opt.flag, opt.desc, (raw: string, prev: unknown) =>
        opt.kv
          ? toKv(raw, prev as Record<string, string>)
          : [...((prev as unknown[]) ?? []), opt.coerce ? opt.coerce(raw) : raw],
      );
    } else if (opt.coerce) {
      cmd.option(opt.flag, opt.desc, opt.coerce);
    } else {
      cmd.option(opt.flag, opt.desc);
    }
  }
  cmd.option('--json', 'emit machine-readable JSON');
  cmd.action(async (...actionArgs: unknown[]) => {
    // commander passes positionals first, then the options object, then the Command instance.
    const opts = actionArgs[actionArgs.length - 2] as Record<string, unknown>;
    if (desc.argument) opts[desc.argument.prop] = actionArgs[0];
    try {
      const result = await desc.run(getPrisma(), opts);
      printResult(result, Boolean(opts.json));
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
  });
  return cmd;
}

export function buildProgram(getPrisma: () => PrismaClient, commands: SeedCommand[]): Command {
  const program = new Command('sm-survey').description('survey-api seed CLI');
  const groups = new Map<string, Command>();
  for (const desc of commands) {
    if (desc.group === 'root') {
      program.addCommand(defineCommand(desc, getPrisma)); // top-level: `sm-survey reset`, `scenario`
      continue;
    }
    if (!groups.has(desc.group))
      groups.set(desc.group, new Command(desc.group).description(`${desc.group} commands`));
    groups.get(desc.group)!.addCommand(defineCommand(desc, getPrisma));
  }
  for (const g of groups.values()) program.addCommand(g);
  return program;
}
