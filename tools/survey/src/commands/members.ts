import type { SeedCommand } from '../define';
import { toAddress } from '../define';
import { resolveAddress } from '../gen';

function requireOperator(args: Record<string, unknown>): string {
  const op = args.operator as string | undefined;
  if (!op) throw new Error('--operator is required');
  return op;
}

export const membersCommands: SeedCommand[] = [
  {
    group: 'members',
    name: 'set',
    summary: 'Set the ActiveMembers row for an operator (4 slots; missing filled randomly)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      {
        flag: '--member <a...>',
        desc: 'member address (up to 4)',
        repeatable: true,
        coerce: toAddress,
      },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const members = (args.member as string[] | undefined) ?? [];
      const data: Record<string, unknown> = { nodeOperatorId };
      for (let i = 1; i <= 4; i++) {
        data[`member${i}Address`] = resolveAddress(members[i - 1]);
        data[`member${i}DiscordHandle`] = null;
        data[`member${i}TelegramUsername`] = null;
      }
      const row = await prisma.activeMembers.upsert({
        where: { nodeOperatorId },
        create: data as never,
        update: data as never,
      });
      return { entity: 'members', action: 'set', operator: nodeOperatorId, members: row };
    },
  },
  {
    group: 'members',
    name: 'clear',
    summary: 'Delete the ActiveMembers row for an operator',
    options: [{ flag: '--operator <id>', desc: 'node operator id' }],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const { count } = await prisma.activeMembers.deleteMany({ where: { nodeOperatorId } });
      return { entity: 'members', action: 'clear', operator: nodeOperatorId, deleted: count };
    },
  },
];
