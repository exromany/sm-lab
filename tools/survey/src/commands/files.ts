import type { SeedCommand } from '../define';

export const filesCommands: SeedCommand[] = [
  {
    group: 'files',
    name: 'clear',
    summary: 'Delete all OperatorFile rows for an operator',
    options: [{ flag: '--operator <id>', desc: 'node operator id' }],
    run: async (prisma, args) => {
      const nodeOperatorId = args.operator as string | undefined;
      if (!nodeOperatorId) throw new Error('--operator is required');
      const { count } = await prisma.operatorFile.deleteMany({ where: { nodeOperatorId } });
      return { entity: 'files', action: 'clear', operator: nodeOperatorId, deleted: count };
    },
  },
];
