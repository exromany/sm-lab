import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { idvtcCommands } from '../src/commands/idvtc';

const A1 = '0x' + '1'.repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(() => prisma, idvtcCommands).parseAsync(argv, { from: 'user' });
}

describe('idvtc seed', () => {
  it('supersedes prior forms, creates 4-member form, binds (issued + bound) with --bind', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 3 } as any);
    await run(prisma, [
      'idvtc',
      'seed',
      '--operator',
      '7',
      '--status',
      'approved',
      '--bind',
      '--main-address',
      A1,
    ]);
    expect(tx.idvtcForm.updateMany).toHaveBeenCalledWith({
      where: { mainAddress: A1 },
      data: { outdated: true },
    });
    expect(tx.idvtcForm.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.idvtcForm.create.mock.invocationCallOrder[0]!,
    );
    const data = tx.idvtcForm.create.mock.calls[0]![0].data;
    expect(data.boundToNodeOperatorId).toBe('7');
    expect(data.issued).toBe(true); // real initFromIdvtc sets issued + bound atomically
    expect(data.clusterAddress1).toMatch(/^0x[0-9a-f]{40}$/);
    expect(data.clusterSignature1).toBe('0x' + '00'.repeat(65));
    expect(data.review!.create!.status).toBe('APPROVED');
  });

  it('leaves boundToNodeOperatorId null and issued unset without --bind', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 4 } as any);
    await run(prisma, ['idvtc', 'seed', '--operator', '7']);
    const data = tx.idvtcForm.create.mock.calls[0]![0].data;
    expect(data.boundToNodeOperatorId).toBeNull();
    expect(data.issued).toBeUndefined();
  });

  it('defaults to APPROVED with --bind and rejects an explicit non-approved status', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 5 } as any);
    await run(prisma, ['idvtc', 'seed', '--operator', '7', '--bind']);
    expect(tx.idvtcForm.create.mock.calls[0]![0].data.review!.create!.status).toBe('APPROVED');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['idvtc', 'seed', '--operator', '7', '--bind', '--status', 'rejected']);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});

describe('idvtc review', () => {
  it('updates the active form review', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.idvtcForm.findFirst.mockResolvedValue({ id: 2, review: { id: 8 } } as any);
    await run(prisma, [
      'idvtc',
      'review',
      '--main-address',
      '0x' + '2'.repeat(40),
      '--status',
      'approved',
    ]);
    expect(prisma.idvtcFormReview.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: expect.objectContaining({ status: 'APPROVED' }),
    });
  });
});
