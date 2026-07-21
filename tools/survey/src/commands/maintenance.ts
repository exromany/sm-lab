import type { PrismaClient } from '../db';
import type { SeedCommand } from '../define';
import { toAddress } from '../define';
import { assertAddress } from '../gen';

/** Delete every operator-keyed row for an operator, plus IDVTC forms bound to it. */
export async function wipeOperator(
  tx: PrismaClient,
  nodeOperatorId: string,
): Promise<Record<string, number>> {
  const c: Record<string, number> = {};
  c.activeMembers = (await tx.activeMembers.deleteMany({ where: { nodeOperatorId } })).count;
  c.rotationRequests = (await tx.rotationRequest.deleteMany({ where: { nodeOperatorId } })).count;
  c.operatorFiles = (await tx.operatorFile.deleteMany({ where: { nodeOperatorId } })).count;
  c.setup = (await tx.setup.deleteMany({ where: { nodeOperatorId } })).count;
  c.setupSnapshots = (await tx.setupSnapshot.deleteMany({ where: { nodeOperatorId } })).count;
  c.contacts = (await tx.contacts.deleteMany({ where: { nodeOperatorId } })).count;
  c.experience = (await tx.experience.deleteMany({ where: { nodeOperatorId } })).count;
  c.howDidYouLearnCsm = (
    await tx.howDidYouLearnCsm.deleteMany({ where: { nodeOperatorId } })
  ).count;
  c.delegates = (await tx.delegate.deleteMany({ where: { nodeOperatorId } })).count;
  c.idvtcFormsBound = (
    await tx.idvtcForm.deleteMany({ where: { boundToNodeOperatorId: nodeOperatorId } })
  ).count;
  return c;
}

export const resetCommand: SeedCommand = {
  group: 'root',
  name: 'reset',
  summary: 'Wipe an operator across tables (address-keyed forms only with --main-address)',
  options: [
    { flag: '--operator <id>', desc: 'node operator id' },
    {
      flag: '--main-address <a>',
      desc: 'also delete ICS/IDVTC forms for this address',
      coerce: toAddress,
    },
  ],
  run: async (prisma, args) => {
    const nodeOperatorId = args.operator as string | undefined;
    if (!nodeOperatorId) throw new Error('--operator is required');
    const mainAddress = args.mainAddress as string | undefined;
    const deleted = await prisma.$transaction(async (tx) => {
      const counts = await wipeOperator(tx as unknown as PrismaClient, nodeOperatorId);
      if (mainAddress) {
        const addr = assertAddress(mainAddress);
        counts.icsFormsByAddress = (
          await tx.icsForm.deleteMany({ where: { mainAddress: addr } })
        ).count;
        counts.idvtcFormsByAddress = (
          await tx.idvtcForm.deleteMany({ where: { mainAddress: addr } })
        ).count;
      }
      return counts;
    });
    return {
      entity: 'reset',
      operator: nodeOperatorId,
      deleted,
      ...(mainAddress
        ? {}
        : { note: 'ICS/IDVTC forms are address-keyed — pass --main-address to clear them' }),
    };
  },
};
