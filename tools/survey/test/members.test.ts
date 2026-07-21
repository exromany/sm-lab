import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { membersCommands } from '../src/commands/members';

function run(prisma: PrismaClient, argv: string[]) {
  return buildProgram(prisma, membersCommands).parseAsync(argv, { from: 'user' });
}

describe('members set', () => {
  it('upserts ActiveMembers with 4 lowercased addresses (random-filled)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.activeMembers.upsert.mockResolvedValue({ id: 1 } as any);
    await run(prisma, ['members', 'set', '--operator', '42', '--member', '0x' + 'A'.repeat(40)]);
    const arg = prisma.activeMembers.upsert.mock.calls[0]![0];
    expect(arg.where).toEqual({ nodeOperatorId: '42' });
    expect(arg.create.member1Address).toBe('0x' + 'a'.repeat(40));
    expect(arg.create.member4Address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});

describe('members clear', () => {
  it('deletes the ActiveMembers row by operator', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.activeMembers.deleteMany.mockResolvedValue({ count: 1 } as any);
    await run(prisma, ['members', 'clear', '--operator', '42']);
    expect(prisma.activeMembers.deleteMany).toHaveBeenCalledWith({
      where: { nodeOperatorId: '42' },
    });
  });
});
