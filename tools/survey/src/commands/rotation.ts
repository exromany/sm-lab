import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import { resolveReviewerId } from './ics';
import { RotationRequestStatus } from '../db';

const ROTATION_COMMENTS: Record<string, string> = {
  reason: 'comment',
  slot1: 'slot1Comment',
  slot2: 'slot2Comment',
  slot3: 'slot3Comment',
  slot4: 'slot4Comment',
};

/** Up to 4 slot addresses → paired NewAddress/Signature columns; empty slots null (honors the CHECK). */
export function buildSlotColumns(addresses: string[]): Record<string, string | null> {
  const cols: Record<string, string | null> = {};
  for (let i = 1; i <= 4; i++) {
    const addr = addresses[i - 1] ?? null;
    cols[`slot${i}NewAddress`] = addr;
    cols[`slot${i}Signature`] = addr ? placeholderSignature() : null;
  }
  return cols;
}

type MemberFields = Record<string, string | null>;

/** Faithful port of survey-api `src/http/members/lib/merge-slots.ts`: patched slots win, null slots
 * carry over from the current ActiveMembers; all 4 required on first init; duplicates rejected. */
export function mergeSlots(active: MemberFields | null, request: MemberFields): MemberFields {
  const merged: MemberFields = {};
  for (const i of [1, 2, 3, 4]) {
    const newAddr = request[`slot${i}NewAddress`];
    if (newAddr != null) {
      merged[`member${i}Address`] = newAddr;
      merged[`member${i}DiscordHandle`] = request[`slot${i}DiscordHandle`] ?? null;
      merged[`member${i}TelegramUsername`] = request[`slot${i}TelegramUsername`] ?? null;
    } else {
      if (!active) throw new Error(`all 4 slots required for first-time init; slot ${i} missing`);
      merged[`member${i}Address`] = active[`member${i}Address`] ?? null;
      merged[`member${i}DiscordHandle`] = active[`member${i}DiscordHandle`] ?? null;
      merged[`member${i}TelegramUsername`] = active[`member${i}TelegramUsername`] ?? null;
    }
  }
  const addrs = [1, 2, 3, 4].map((i) => merged[`member${i}Address`]);
  if (new Set(addrs).size !== 4) throw new Error('duplicate addresses in merged members');
  return merged;
}

function requireOperator(args: Record<string, unknown>): string {
  const op = args.operator as string | undefined;
  if (!op) throw new Error('--operator is required');
  return op;
}

export const rotationCommands: SeedCommand[] = [
  {
    group: 'rotation',
    name: 'create',
    summary:
      'Create a rotation request (supersedes prior open request; pads to 4 slots on first init)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      {
        flag: '--slot <a...>',
        desc: 'new slot address (up to 4; 1 random if none)',
        repeatable: true,
        coerce: toAddress,
      },
      { flag: '--submitter <a>', desc: 'submitter address (random if omitted)', coerce: toAddress },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const submitterAddress = resolveAddress(args.submitter as string | undefined);
      const slots = (args.slot as string[] | undefined) ?? [];
      if (slots.length === 0) slots.push(resolveAddress());
      // First-time init: with no ActiveMembers row the real system requires all 4 slots — pad randomly,
      // otherwise the request could never be approved (mergeSlots throws on first init with <4 slots).
      const active = await prisma.activeMembers.findUnique({ where: { nodeOperatorId } });
      if (!active) while (slots.length < 4) slots.push(resolveAddress());
      const cols = buildSlotColumns(slots);
      const created = await prisma.$transaction(async (tx) => {
        await tx.rotationRequest.updateMany({
          where: {
            nodeOperatorId,
            superseded: false,
            status: { not: RotationRequestStatus.APPROVED },
          },
          data: { superseded: true },
        });
        return tx.rotationRequest.create({
          data: { nodeOperatorId, submitterAddress, ...cols } as never,
        });
      });
      return {
        entity: 'rotation',
        action: 'create',
        operator: nodeOperatorId,
        submitterAddress,
        request: created,
      };
    },
  },
  {
    group: 'rotation',
    name: 'review',
    summary: 'Review the open rotation request (approve applies merged slots to ActiveMembers)',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      {
        flag: '--comment <kv...>',
        desc: 'field=text comment (reason|slot1..slot4)',
        repeatable: true,
        kv: true,
      },
      {
        flag: '--reviewer <a>',
        desc: 'reviewer admin address (create-if-missing)',
        coerce: toAddress,
      },
    ],
    run: async (prisma, args) => {
      const nodeOperatorId = requireOperator(args);
      const status = args.status as string | undefined;
      if (!status) throw new Error('--status is required');
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const comments: Record<string, unknown> = {};
      for (const [k, v] of Object.entries((args.comment as Record<string, string>) ?? {})) {
        const col = ROTATION_COMMENTS[k];
        if (!col)
          throw new Error(
            `Unknown comment field '${k}' (expected: ${Object.keys(ROTATION_COMMENTS).join(', ')})`,
          );
        comments[col] = v || null;
      }
      const updated = await prisma.$transaction(async (tx) => {
        const open = await tx.rotationRequest.findFirst({
          where: { nodeOperatorId, superseded: false, status: RotationRequestStatus.REVIEW },
          orderBy: { createdAt: 'desc' },
        });
        if (!open) throw new Error(`No open rotation request for operator ${nodeOperatorId}`);
        if (status === RotationRequestStatus.APPROVED) {
          // Mirror the real admin patch: approval lands the merged slots in ActiveMembers.
          const active = await tx.activeMembers.findUnique({ where: { nodeOperatorId } });
          const merged = mergeSlots(active as MemberFields | null, open as unknown as MemberFields);
          await tx.activeMembers.upsert({
            where: { nodeOperatorId },
            create: { nodeOperatorId, ...merged } as never,
            update: merged as never,
          });
        }
        return tx.rotationRequest.update({
          where: { id: open.id },
          data: {
            status,
            reviewedAt: new Date(),
            ...(lastReviewerId !== undefined ? { lastReviewerId } : {}),
            ...comments,
          } as never,
        });
      });
      return { entity: 'rotation', action: 'review', operator: nodeOperatorId, request: updated };
    },
  },
];
