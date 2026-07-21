import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { icsCommands } from '../src/commands/ics';

const A1 = '0x' + '1'.repeat(40);
const A2 = '0x' + '2'.repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, icsCommands).parseAsync(argv, { from: 'user' });
}

describe('ics seed', () => {
  it('marks prior forms outdated then creates with the given status', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.icsForm.create.mockResolvedValue({ id: 17 } as any);
    await run(prisma, [
      'ics',
      'seed',
      '--operator',
      '42',
      '--status',
      'approved',
      '--main-address',
      A1,
    ]);
    expect(tx.icsForm.updateMany).toHaveBeenCalledWith({
      where: { mainAddress: A1 },
      data: { outdated: true },
    });
    expect(tx.icsForm.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.icsForm.create.mock.invocationCallOrder[0]!,
    );
    const arg = tx.icsForm.create.mock.calls[0]![0];
    expect(arg.data.mainAddress).toBe(A1);
    expect(arg.data.review!.create!.status).toBe('APPROVED');
  });
});

describe('ics review', () => {
  it('updates the active form review with status/comments/points', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    await run(prisma, [
      'ics',
      'review',
      '--main-address',
      A2,
      '--status',
      'rejected',
      '--comment',
      'mainAddress=bad',
      '--points',
      'ethStaker=3',
    ]);
    expect(prisma.icsForm.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { mainAddress: A2, outdated: false } }),
    );
    expect(prisma.icsFormReview.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: 'REJECTED',
        mainAddressComment: 'bad',
        ethStakerPoints: 3,
      }),
    });
  });

  it('rejects a non-integer --points value', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, [
      'ics',
      'review',
      '--main-address',
      A2,
      '--status',
      'rejected',
      '--points',
      'ethStaker=abc',
    ]);
    expect(process.exitCode).toBe(1);
    expect(prisma.icsFormReview.update).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('errors when no active form exists', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue(null as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, [
      'ics',
      'review',
      '--main-address',
      '0x' + '3'.repeat(40),
      '--status',
      'approved',
    ]);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('marks the form issued with --issued (approved only)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    await run(prisma, ['ics', 'review', '--main-address', A2, '--status', 'approved', '--issued']);
    expect(prisma.icsForm.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { issued: true },
    });
  });

  it('rejects --issued without --status approved', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.icsForm.findFirst.mockResolvedValue({ id: 5, review: { id: 9 } } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['ics', 'review', '--main-address', A2, '--status', 'rejected', '--issued']);
    expect(process.exitCode).toBe(1);
    expect(prisma.icsForm.update).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
