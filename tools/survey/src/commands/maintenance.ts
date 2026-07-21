import type { PrismaClient } from '../db';
import type { SeedCommand } from '../define';
import { toAddress } from '../define';
import { assertAddress, resolveAddress } from '../gen';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';
import { membersCommands } from './members';
import { rotationCommands } from './rotation';

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

function runner(commands: SeedCommand[], name: string) {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`missing command ${name}`);
  return c.run;
}

const icsSeed = runner(icsCommands, 'seed');
const idvtcSeed = runner(idvtcCommands, 'seed');
const membersSet = runner(membersCommands, 'set');
const rotationCreate = runner(rotationCommands, 'create');

export const SCENARIOS: Record<
  string,
  (prisma: PrismaClient, operator: string) => Promise<unknown>
> = {
  'approved-ics': async (prisma, operator) => ({
    ics: await icsSeed(prisma, { operator, status: 'APPROVED' }),
  }),

  'idvtc-with-members': async (prisma, operator) => {
    // Mirror initFromIdvtc: ActiveMembers must hold the SAME addresses as the bound form's cluster.
    const member = Array.from({ length: 4 }, () => resolveAddress());
    const idvtc = await idvtcSeed(prisma, { operator, status: 'APPROVED', bind: true, member });
    const members = await membersSet(prisma, { operator, member });
    return { idvtc, members };
  },

  'pending-rotation': async (prisma, operator) => {
    const members = await membersSet(prisma, { operator });
    const rotation = await rotationCreate(prisma, { operator });
    return { members, rotation };
  },
};

export const scenarioCommand: SeedCommand = {
  group: 'root',
  name: 'scenario',
  summary: `Compose a full operator scenario (${Object.keys(SCENARIOS).join(', ')})`,
  argument: { name: 'name', desc: 'scenario name', prop: 'name' },
  options: [{ flag: '--operator <id>', desc: 'node operator id' }],
  run: async (prisma, args) => {
    const name = args.name as string | undefined;
    const operator = args.operator as string | undefined;
    if (!operator) throw new Error('--operator is required');
    if (!name || !SCENARIOS[name]) {
      throw new Error(
        `Unknown scenario '${name ?? ''}' (expected: ${Object.keys(SCENARIOS).join(', ')})`,
      );
    }
    return { entity: 'scenario', name, operator, result: await SCENARIOS[name](prisma, operator) };
  },
};
