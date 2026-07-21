import { describe, it, expect } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { PrismaClient } from '../src/db';
import { buildProgram } from '../src/define';
import { filesCommands } from '../src/commands/files';

describe('files clear', () => {
  it('deletes all OperatorFile rows for an operator', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.operatorFile.deleteMany.mockResolvedValue({ count: 3 } as any);
    await buildProgram(prisma, filesCommands).parseAsync(['files', 'clear', '--operator', '42'], {
      from: 'user',
    });
    expect(prisma.operatorFile.deleteMany).toHaveBeenCalledWith({
      where: { nodeOperatorId: '42' },
    });
  });
});
