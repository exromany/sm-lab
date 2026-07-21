import { describe, it, expect, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { scenarioCommand, SCENARIOS } from '../src/commands/maintenance';

function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, [scenarioCommand]).parseAsync(argv, { from: 'user' });
}

describe('scenario', () => {
  it('exposes the three starter scenarios', () => {
    expect(Object.keys(SCENARIOS).toSorted()).toEqual([
      'approved-ics',
      'idvtc-with-members',
      'pending-rotation',
    ]);
  });

  it('idvtc-with-members seeds a bound approved form + matching active members', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.idvtcForm.create.mockResolvedValue({ id: 1 } as any);
    prisma.activeMembers.upsert.mockResolvedValue({ id: 1 } as any);
    await run(prisma, ['scenario', 'idvtc-with-members', '--operator', '9']);
    const form = tx.idvtcForm.create.mock.calls[0]![0].data as any;
    expect(form.boundToNodeOperatorId).toBe('9');
    expect(form.issued).toBe(true);
    const up = prisma.activeMembers.upsert.mock.calls[0]![0] as any;
    expect(up.where).toEqual({ nodeOperatorId: '9' });
    // Mirrors initFromIdvtc: ActiveMembers holds the SAME addresses as the bound form's cluster.
    for (const i of [1, 2, 3, 4])
      expect(up.create[`member${i}Address`]).toBe(form[`clusterAddress${i}`]);
  });

  it('rejects an unknown scenario name', async () => {
    const prisma = mockDeep<PrismaClient>();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(prisma, ['scenario', 'nope', '--operator', '9']);
    expect(process.exitCode).toBe(1);
    vi.restoreAllMocks();
    process.exitCode = 0;
  });
});
