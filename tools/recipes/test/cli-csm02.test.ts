import { describe, expect, it, vi } from 'vitest';
import { csm02Commands } from '../src/cli/commands/csm02';
import { defineCommand } from '../src/cli/define';
import { buildProgram } from '../src/cli/program';
import { makeFakeClient } from './helpers/fake-client';
import { fakeCtx } from './helpers/book';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('csm02Commands', () => {
  it('exposes create-operator, register-module, top-up-queue, all forcing module csm02', () => {
    expect(csm02Commands.map((c) => c.name).toSorted()).toEqual(
      ['create-operator', 'register-module', 'top-up-queue'].toSorted(),
    );
    expect(csm02Commands.every((c) => c.module === 'csm02')).toBe(true);
  });

  it('create-operator carries no gate/selector options (csm02 is permissionless-only)', () => {
    const co = csm02Commands.find((c) => c.name === 'create-operator')!;
    expect(co.options.some((o) => o.key === 'selector')).toBe(false);
    expect(co.options.some((o) => o.key === 'fromCid' || o.key === 'cid')).toBe(false);
    const args = defineCommand(co).registeredArguments;
    expect(args.map((a) => a.name())).toEqual(['keys']);
  });

  it('top-up-queue uses --operator-id (key noId), not a --no-* flag', () => {
    const tuq = csm02Commands.find((c) => c.name === 'top-up-queue')!;
    const opId = tuq.options.find((o) => o.key === 'noId')!;
    expect(opId.flag).toBe('--operator-id <id>');
  });
});

describe('buildProgram — csm02 group', () => {
  const p = buildProgram();

  it('registers the csm02 group alongside cm/csm', () => {
    const names = p.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['cm', 'csm', 'csm02']));
  });

  it('the csm02 group lists its own commands plus mirrored shared ones', () => {
    const csm02Names = p.commands.find((c) => c.name() === 'csm02')!.commands.map((c) => c.name());
    expect(csm02Names).toEqual(
      expect.arrayContaining(['create-operator', 'register-module', 'top-up-queue']),
    );
    expect(csm02Names).toEqual(expect.arrayContaining(['operator-info', 'add-keys', 'deposit']));
  });
});

describe('csm02 group — forces ctx.module without --module', () => {
  it('runs a mirrored shared command with module csm02', async () => {
    const { client } = makeFakeClient({ reads: { getNodeOperator: { totalDepositedKeys: 2 } } });
    const ctx = fakeCtx('csm02', client);
    const connect = vi.fn(async () => ctx);
    const prog = buildProgram(connect as never)
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });

    await prog.parseAsync(['csm02', 'operator-info', '--operator-id', '0'], { from: 'user' });
    await tick();

    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ module: 'csm02' }));
  });

  it('top-up-queue reports "disabled" and reads no items when enabled=false', async () => {
    const { client, byMethod } = makeFakeClient({
      reads: { getTopUpQueue: [false, 0n, 0n, 0n] },
    });
    const ctx = fakeCtx('csm02', client);
    const connect = async () => ctx;
    const prog = buildProgram(connect as never)
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });

    const stdoutLines: string[] = [];
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation((...a) => stdoutLines.push(a.join(' ')));
    await prog.parseAsync(['csm02', 'top-up-queue'], { from: 'user' });
    await tick();
    log.mockRestore();

    expect(stdoutLines).toEqual(['top-up queue disabled']);
    expect(byMethod('readContract')).toHaveLength(1); // just getTopUpQueue — no item reads
  });

  it('top-up-queue --json emits the raw snapshot with bigints as strings', async () => {
    const { client } = makeFakeClient({
      reads: {
        getTopUpQueue: [true, 10n, 2n, 5n],
        getTopUpQueueItem: (args: unknown[]) =>
          (args as [bigint])[0] === 0n ? [1n, 0n] : [1n, 1n],
      },
    });
    const ctx = fakeCtx('csm02', client);
    const connect = async () => ctx;
    const prog = buildProgram(connect as never)
      .exitOverride()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined });

    const stdoutLines: string[] = [];
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation((...a) => stdoutLines.push(a.join(' ')));
    await prog.parseAsync(['csm02', '--json', 'top-up-queue'], { from: 'user' });
    await tick();
    log.mockRestore();

    expect(stdoutLines).toHaveLength(1);
    expect(JSON.parse(stdoutLines[0]!)).toEqual({
      enabled: true,
      limit: '10',
      length: '2',
      head: '5',
      items: [
        { index: '0', noId: '1', keyIndex: '0' },
        { index: '1', noId: '1', keyIndex: '1' },
      ],
    });
  });
});
