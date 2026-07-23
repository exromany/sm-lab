import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { rotationCommands, buildSlotColumns, mergeSlots } from '../src/commands/rotation';

const A1 = '0x' + '1'.repeat(40);
const B = (n: number) => '0x' + String(n).repeat(40);
function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(() => prisma, rotationCommands).parseAsync(argv, { from: 'user' });
}
const openRequest = (slots: Record<string, string | null> = {}) => ({
  id: 5,
  slot1NewAddress: null,
  slot1DiscordHandle: null,
  slot1TelegramUsername: null,
  slot2NewAddress: null,
  slot2DiscordHandle: null,
  slot2TelegramUsername: null,
  slot3NewAddress: null,
  slot3DiscordHandle: null,
  slot3TelegramUsername: null,
  slot4NewAddress: null,
  slot4DiscordHandle: null,
  slot4TelegramUsername: null,
  ...slots,
});
const activeRow = () => ({
  member1Address: B(6),
  member1DiscordHandle: 'd1',
  member1TelegramUsername: null,
  member2Address: B(7),
  member2DiscordHandle: null,
  member2TelegramUsername: 't2',
  member3Address: B(8),
  member3DiscordHandle: null,
  member3TelegramUsername: null,
  member4Address: B(9),
  member4DiscordHandle: null,
  member4TelegramUsername: null,
});

describe('buildSlotColumns', () => {
  it('pairs address with placeholder sig, nulls empty slots', () => {
    const c = buildSlotColumns([A1]);
    expect(c.slot1NewAddress).toBe(A1);
    expect(c.slot1Signature).toBe('0x' + '00'.repeat(65));
    expect(c.slot2NewAddress).toBeNull();
    expect(c.slot2Signature).toBeNull();
  });
});

describe('mergeSlots', () => {
  it('patched slots win, null slots carry over from active', () => {
    const m = mergeSlots(activeRow(), openRequest({ slot1NewAddress: A1 }) as any);
    expect(m.member1Address).toBe(A1);
    expect(m.member1DiscordHandle).toBeNull();
    expect(m.member2Address).toBe(B(7));
    expect(m.member2TelegramUsername).toBe('t2');
  });
  it('requires all 4 slots on first init', () => {
    expect(() => mergeSlots(null, openRequest({ slot1NewAddress: A1 }) as any)).toThrow(
      'first-time init',
    );
  });
  it('rejects duplicate merged addresses', () => {
    expect(() => mergeSlots(activeRow(), openRequest({ slot1NewAddress: B(7) }) as any)).toThrow(
      'duplicate',
    );
  });
});

describe('rotation create', () => {
  it('supersedes prior open requests then creates a REVIEW request', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    prisma.activeMembers.findUnique.mockResolvedValue(activeRow() as any);
    tx.rotationRequest.create.mockResolvedValue({ id: 11 } as any);
    await run(prisma, ['rotation', 'create', '--operator', '42', '--slot', A1]);
    expect(tx.rotationRequest.updateMany).toHaveBeenCalledWith({
      where: { nodeOperatorId: '42', superseded: false, status: { not: 'APPROVED' } },
      data: { superseded: true },
    });
    expect(tx.rotationRequest.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.rotationRequest.create.mock.invocationCallOrder[0]!,
    );
    const data = tx.rotationRequest.create.mock.calls[0]![0].data as any;
    expect(data.nodeOperatorId).toBe('42');
    expect(data.slot1NewAddress).toBe(A1);
    expect(data.slot1Signature).toBe('0x' + '00'.repeat(65));
    expect(data.slot2NewAddress).toBeNull(); // members exist → no padding
  });

  it('pads to 4 slots when the operator has no ActiveMembers row (first-init rule)', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    prisma.activeMembers.findUnique.mockResolvedValue(null as any);
    tx.rotationRequest.create.mockResolvedValue({ id: 12 } as any);
    await run(prisma, ['rotation', 'create', '--operator', '42', '--slot', A1]);
    const data = tx.rotationRequest.create.mock.calls[0]![0].data as any;
    expect(data.slot1NewAddress).toBe(A1);
    for (const i of [2, 3, 4]) expect(data[`slot${i}NewAddress`]).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('rotation review', () => {
  it('approve merges slots into ActiveMembers, then updates the request', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.rotationRequest.findFirst.mockResolvedValue(openRequest({ slot1NewAddress: A1 }) as any);
    tx.activeMembers.findUnique.mockResolvedValue(activeRow() as any);
    tx.rotationRequest.update.mockResolvedValue({ id: 5 } as any);
    await run(prisma, [
      'rotation',
      'review',
      '--operator',
      '42',
      '--status',
      'approved',
      '--comment',
      'slot1=ok',
    ]);
    expect(tx.rotationRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nodeOperatorId: '42', superseded: false, status: 'REVIEW' },
      }),
    );
    const up = tx.activeMembers.upsert.mock.calls[0]![0] as any;
    expect(up.where).toEqual({ nodeOperatorId: '42' });
    expect(up.update.member1Address).toBe(A1); // patched slot wins
    expect(up.update.member2Address).toBe(B(7)); // null slot carried over
    const arg = tx.rotationRequest.update.mock.calls[0]![0] as any;
    expect(arg.where).toEqual({ id: 5 });
    expect(arg.data.status).toBe('APPROVED');
    expect(arg.data.slot1Comment).toBe('ok');
    expect(arg.data.reviewedAt).toBeInstanceOf(Date);
  });

  it('reject leaves ActiveMembers untouched', async () => {
    const prisma = mockDeep<PrismaClient>();
    const tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.rotationRequest.findFirst.mockResolvedValue(openRequest({ slot1NewAddress: A1 }) as any);
    tx.rotationRequest.update.mockResolvedValue({ id: 5 } as any);
    await run(prisma, ['rotation', 'review', '--operator', '42', '--status', 'rejected']);
    expect(tx.activeMembers.upsert).not.toHaveBeenCalled();
    expect((tx.rotationRequest.update.mock.calls[0]![0] as any).data.status).toBe('REJECTED');
  });
});
