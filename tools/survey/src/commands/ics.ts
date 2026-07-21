import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import type { PrismaClient } from '../db';
import { IcsFormStatus } from '../db';

export const ICS_COMMENTS: Record<string, string> = {
  reason: 'comment',
  mainAddress: 'mainAddressComment',
  twitterLink: 'twitterLinkComment',
  discordLink: 'discordLinkComment',
  additional1: 'additionalComment1',
  additional2: 'additionalComment2',
  additional3: 'additionalComment3',
  additional4: 'additionalComment4',
  additional5: 'additionalComment5',
};

export const ICS_POINTS: Record<string, string> = {
  ethStaker: 'ethStakerPoints',
  stakeCat: 'stakeCatPoints',
  obolTechne: 'obolTechnePoints',
  ssvVerified: 'ssvVerifiedPoints',
  csmTestnet: 'csmTestnetPoints',
  csmMainnet: 'csmMainnetPoints',
  sdvtTestnet: 'sdvtTestnetPoints',
  sdvtMainnet: 'sdvtMainnetPoints',
  humanPassport: 'humanPassportPoints',
  circles: 'circlesPoints',
  discord: 'discordPoints',
  twitter: 'twitterPoints',
  ssvHumanity: 'ssvHumanityPoints',
  aragonVotes: 'aragonVotesPoints',
  snapshotVotes: 'snapshotVotesPoints',
  lidoGalxe: 'lidoGalxePoints',
  highSignal: 'highSignalPoints',
  gitPoaps: 'gitPoapsPoints',
};

/** Map {cliKey: value} → {column: transformed}, rejecting unknown keys. */
export function mapFields<T>(
  input: Record<string, string> | undefined,
  fieldMap: Record<string, string>,
  transform: (raw: string) => T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    const col = fieldMap[k];
    if (!col)
      throw new Error(`Unknown field '${k}' (expected: ${Object.keys(fieldMap).join(', ')})`);
    out[col] = transform(v);
  }
  return out;
}

/** Create-if-missing an AdminUser for a reviewer address; return its id, or undefined. */
export async function resolveReviewerId(
  prisma: Pick<PrismaClient, 'adminUser'>,
  address?: string,
): Promise<number | undefined> {
  if (!address) return undefined;
  const row = await prisma.adminUser.upsert({
    where: { address },
    create: { address, role: 'REVIEWER' },
    update: {},
  });
  return row.id;
}

export const icsCommands: SeedCommand[] = [
  {
    group: 'ics',
    name: 'seed',
    summary: 'Create an ICS form for an address in any status',
    options: [
      { flag: '--operator <id>', desc: 'node operator id (informational for ICS)' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--main-address <a>', desc: 'main address (random if omitted)', coerce: toAddress },
      { flag: '--twitter <s>', desc: 'twitter link' },
      { flag: '--discord <s>', desc: 'discord link' },
      {
        flag: '--additional <a...>',
        desc: 'additional address',
        repeatable: true,
        coerce: toAddress,
      },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      { flag: '--points <kv...>', desc: 'field=n proof score', repeatable: true, kv: true },
    ],
    run: async (prisma, args) => {
      const mainAddress = resolveAddress(args.mainAddress as string | undefined);
      const status = (args.status as string | undefined) ?? IcsFormStatus.REVIEW;
      const additional = (args.additional as string[] | undefined) ?? [];
      const reviewData: Record<string, unknown> = {
        status,
        ...mapFields(args.comment as Record<string, string>, ICS_COMMENTS, (s) => s || null),
        ...mapFields(args.points as Record<string, string>, ICS_POINTS, (s) => Number(s)),
      };
      const formData: Record<string, unknown> = {
        mainAddress,
        twitterLink: (args.twitter as string) ?? null,
        discordLink: (args.discord as string) ?? null,
      };
      additional.slice(0, 5).forEach((addr, i) => {
        formData[`additionalAddress${i + 1}`] = addr;
        formData[`additionalSignature${i + 1}`] = placeholderSignature();
      });
      const created = await prisma.$transaction(async (tx) => {
        await tx.icsForm.updateMany({ where: { mainAddress }, data: { outdated: true } });
        return tx.icsForm.create({
          data: { ...formData, review: { create: reviewData } } as never,
          include: { review: true },
        });
      });
      return {
        entity: 'ics',
        action: 'seed',
        operator: args.operator ?? null,
        mainAddress,
        status,
        form: created,
      };
    },
  },
  {
    group: 'ics',
    name: 'review',
    summary: 'Update the active ICS form review (status/comments/points)',
    options: [
      { flag: '--main-address <a>', desc: 'main address of the form', coerce: toAddress },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      { flag: '--points <kv...>', desc: 'field=n proof score', repeatable: true, kv: true },
      {
        flag: '--reviewer <a>',
        desc: 'reviewer admin address (create-if-missing)',
        coerce: toAddress,
      },
      { flag: '--issued', desc: 'mark the proof issued on the form (requires --status approved)' },
    ],
    run: async (prisma, args) => {
      const mainAddress = args.mainAddress as string;
      if (!mainAddress) throw new Error('--main-address is required');
      // issued is an explicit admin action in the real system, APPROVED-only (locks the review).
      const issued = Boolean(args.issued);
      if (issued && args.status !== IcsFormStatus.APPROVED) {
        throw new Error(
          '--issued requires --status approved (proofs are only issued for approved forms)',
        );
      }
      const form = await prisma.icsForm.findFirst({
        where: { mainAddress, outdated: false },
        include: { review: true },
      });
      if (!form || !form.review) throw new Error(`No active ICS form for ${mainAddress}`);
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const data: Record<string, unknown> = {
        ...(args.status ? { status: args.status } : {}),
        ...(lastReviewerId !== undefined ? { lastReviewerId } : {}),
        ...mapFields(args.comment as Record<string, string>, ICS_COMMENTS, (s) => s || null),
        ...mapFields(args.points as Record<string, string>, ICS_POINTS, (s) => Number(s)),
      };
      const updated = await prisma.icsFormReview.update({
        where: { id: form.review.id },
        data: data as never,
      });
      if (issued) await prisma.icsForm.update({ where: { id: form.id }, data: { issued: true } });
      return {
        entity: 'ics',
        action: 'review',
        mainAddress,
        ...(issued ? { issued: true } : {}),
        review: updated,
      };
    },
  },
];
