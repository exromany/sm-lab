import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { resetCommand } from '../src/commands/maintenance';

const MODELS = [
  'activeMembers',
  'rotationRequest',
  'operatorFile',
  'setup',
  'setupSnapshot',
  'contacts',
  'experience',
  'howDidYouLearnCsm',
  'delegate',
  'idvtcForm',
  'icsForm',
] as const;

describe('reset', () => {
  it('clears operator-keyed tables + bound idvtc; reports skipped forms without --main-address', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    for (const m of MODELS) (tx as any)[m].deleteMany.mockResolvedValue({ count: 0 });
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((s?: unknown) => void out.push(String(s)));
    await buildProgram(() => prisma, [resetCommand]).parseAsync(
      ['reset', '--operator', '42', '--json'],
      {
        from: 'user',
      },
    );
    vi.restoreAllMocks();
    expect(tx.activeMembers.deleteMany).toHaveBeenCalledWith({ where: { nodeOperatorId: '42' } });
    expect(tx.idvtcForm.deleteMany).toHaveBeenCalledWith({
      where: { boundToNodeOperatorId: '42' },
    });
    expect(tx.icsForm.deleteMany).not.toHaveBeenCalled();
    expect(JSON.parse(out[0]!).note).toContain('--main-address');
  });

  it('also clears forms by main address when given', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    for (const m of MODELS) (tx as any)[m].deleteMany.mockResolvedValue({ count: 0 });
    await buildProgram(() => prisma, [resetCommand]).parseAsync(
      ['reset', '--operator', '42', '--main-address', '0x' + '1'.repeat(40)],
      { from: 'user' },
    );
    expect(tx.icsForm.deleteMany).toHaveBeenCalledWith({
      where: { mainAddress: '0x' + '1'.repeat(40) },
    });
  });
});
