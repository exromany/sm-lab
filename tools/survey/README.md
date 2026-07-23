# @sm-lab/survey

Direct-DB seed CLI for the Lido CSM survey-api — puts a **local** survey-api Postgres into arbitrary
states for widget/SDK testing. Dev-only tool, published so it's runnable via `npx`. Bypasses
SIWE/signature validation on purpose (signatures are placeholders).

## Run

Set `DATABASE_URL` (the local survey-api Postgres) in `.env`, then:

```
npx @sm-lab/survey <group> <cmd> [--json]
```

Or, inside this monorepo:

```
pnpm --filter @sm-lab/survey exec tsx src/cli.ts <group> <cmd> [--json]
```

Groups: `ics seed|review`, `idvtc seed|review`, `members set|clear`, `rotation create|review`,
`files clear`, plus `reset` and `scenario <name>` (`approved-ics` | `idvtc-with-members` | `pending-rotation`).
Random addresses are generated for anything not passed and echoed in the output. `reset` wipes an
operator; pass `--main-address` to also clear address-keyed ICS/IDVTC forms.

## State invariants replicated

Seeded state matches what the real write paths produce: form creation flips prior rows to `outdated`;
`idvtc seed --bind` sets `issued` **and** `boundToNodeOperatorId` (APPROVED-only, like `initFromIdvtc`);
`rotation create` supersedes the prior open request and pads to 4 slots when the operator has no
`ActiveMembers` row (first-init rule); `rotation review --status approved` merges the request's slots
into `ActiveMembers` in the same transaction (port of survey-api's `mergeSlots`); `ics review --issued`
marks the proof issued (approved forms only — it locks the review in the real admin UI). Seeded reviews
carry a null `lastReviewerId` unless `--reviewer` is given (nullable column; the admin UI tolerates it).

No `setup` seeding: survey-api's own Prisma client auto-assigns `Setup.index` and writes
`SetupSnapshot`s via client extensions the vendored client lacks.

## Syncing the vendored schema with survey-api

The Prisma client is generated from a vendored, **generate-only** copy of survey-api's `schema.prisma`
(sm-lab never migrates). When survey-api's schema changes, re-vendor + regenerate:

```
pnpm --filter @sm-lab/survey refresh --source /path/to/survey-api
# or: SURVEY_API_PATH=/path/to/survey-api pnpm --filter @sm-lab/survey refresh
```

This copies the model/enum blocks, prepends sm-lab's generator/datasource header, runs
`prisma generate`, and records provenance (survey-api ref + commit) in `prisma/manifest.json`. It
refuses a dirty source tree unless `--force`. Check `prisma/manifest.json` to see which survey-api
commit the client currently matches.
