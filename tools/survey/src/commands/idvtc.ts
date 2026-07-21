import type { SeedCommand } from '../define';
import { toAddress, toStatus } from '../define';
import { placeholderSignature, resolveAddress } from '../gen';
import { mapFields, resolveReviewerId } from './ics';
import { IdvtcFormStatus } from '../db';

export const IDVTC_COMMENTS: Record<string, string> = {
  reason: 'comment',
  mainAddress: 'mainAddressComment',
  discordLink: 'discordLinkComment',
  telegramUsername: 'telegramUsernameComment',
  member1: 'clusterMemberComment1',
  member2: 'clusterMemberComment2',
  member3: 'clusterMemberComment3',
  member4: 'clusterMemberComment4',
};

export const idvtcCommands: SeedCommand[] = [
  {
    group: 'idvtc',
    name: 'seed',
    summary: 'Create an IDVTC cluster form for an address in any status',
    options: [
      { flag: '--operator <id>', desc: 'node operator id' },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--main-address <a>', desc: 'main address (random if omitted)', coerce: toAddress },
      { flag: '--discord <s>', desc: 'discord link' },
      { flag: '--telegram <s>', desc: 'telegram username' },
      {
        flag: '--member <a...>',
        desc: 'cluster member address (up to 4)',
        repeatable: true,
        coerce: toAddress,
      },
      {
        flag: '--bind',
        desc: 'bind to --operator (sets issued + boundToNodeOperatorId; implies approved)',
      },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
    ],
    run: async (prisma, args) => {
      const mainAddress = resolveAddress(args.mainAddress as string | undefined);
      const bind = Boolean(args.bind);
      // Real binding (initFromIdvtc) sets issued + boundToNodeOperatorId atomically, APPROVED forms only.
      const status =
        (args.status as string | undefined) ??
        (bind ? IdvtcFormStatus.APPROVED : IdvtcFormStatus.REVIEW);
      if (bind && !args.operator) throw new Error('--bind requires --operator');
      if (bind && status !== IdvtcFormStatus.APPROVED) {
        throw new Error('--bind requires an APPROVED form (only approved forms are ever bound)');
      }
      const members = (args.member as string[] | undefined) ?? [];
      const formData: Record<string, unknown> = {
        mainAddress,
        discordLink: (args.discord as string) ?? 'https://discord.example',
        telegramUsername: (args.telegram as string) ?? null,
        boundToNodeOperatorId: bind ? String(args.operator) : null,
        ...(bind ? { issued: true } : {}),
      };
      for (let i = 1; i <= 4; i++) {
        formData[`clusterAddress${i}`] = resolveAddress(members[i - 1]);
        formData[`clusterSignature${i}`] = placeholderSignature();
      }
      const reviewData: Record<string, unknown> = {
        status,
        ...mapFields(args.comment as Record<string, string>, IDVTC_COMMENTS, (s) => s || null),
      };
      const created = await prisma.$transaction(async (tx) => {
        await tx.idvtcForm.updateMany({ where: { mainAddress }, data: { outdated: true } });
        return tx.idvtcForm.create({
          data: { ...formData, review: { create: reviewData } } as never,
          include: { review: true },
        });
      });
      return {
        entity: 'idvtc',
        action: 'seed',
        operator: args.operator ?? null,
        mainAddress,
        status,
        form: created,
      };
    },
  },
  {
    group: 'idvtc',
    name: 'review',
    summary: 'Update the active IDVTC form review',
    options: [
      { flag: '--main-address <a>', desc: 'main address of the form', coerce: toAddress },
      { flag: '--status <s>', desc: 'review|approved|rejected', coerce: toStatus },
      { flag: '--comment <kv...>', desc: 'field=text review comment', repeatable: true, kv: true },
      {
        flag: '--reviewer <a>',
        desc: 'reviewer admin address (create-if-missing)',
        coerce: toAddress,
      },
    ],
    run: async (prisma, args) => {
      const mainAddress = args.mainAddress as string;
      if (!mainAddress) throw new Error('--main-address is required');
      const form = await prisma.idvtcForm.findFirst({
        where: { mainAddress, outdated: false },
        include: { review: true },
      });
      if (!form || !form.review) throw new Error(`No active IDVTC form for ${mainAddress}`);
      const lastReviewerId = await resolveReviewerId(prisma, args.reviewer as string | undefined);
      const data: Record<string, unknown> = {
        ...(args.status ? { status: args.status } : {}),
        ...(lastReviewerId !== undefined ? { lastReviewerId } : {}),
        ...mapFields(args.comment as Record<string, string>, IDVTC_COMMENTS, (s) => s || null),
      };
      const updated = await prisma.idvtcFormReview.update({
        where: { id: form.review.id },
        data: data as never,
      });
      return { entity: 'idvtc', action: 'review', mainAddress, review: updated };
    },
  },
];
