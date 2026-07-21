# Survey Seed CLI (`@sm-lab/survey`) — Design

**Date:** 2026-07-21
**Status:** Approved (brainstorm) → pending implementation plan

## Overview

A run-and-exit CLI that seeds the **survey-api** Postgres database into arbitrary states for local
development and widget/SDK testing. It lives in **sm-lab** alongside `recipes` as a new tool package
(`tools/survey`, `@sm-lab/survey`, bin `sm-survey`), and writes rows **directly via Prisma** — bypassing
the operator/admin validation gates (SIWE, signature checks, resubmit-only-when-REJECTED) so a developer
can put an operator into any state in one command.

It is the DB-side sibling of the on-chain `recipes` tool: same philosophy (talk to the substrate
directly, replicate just enough invariants to keep state consistent, skip the validation the real path
enforces), same CLI shape (declarative command registry + `defineCommand`/`buildProgram`, universal
`--json`, injectable test seam).

Because sm-lab cannot import survey-api's generated Prisma client, sm-lab **vendors a copy of
survey-api's `schema.prisma`** (generate-only) and generates its own client. See *Syncing with
survey-api*.

## Goals

- Seed ICS and IDVTC forms for an address in any status (REVIEW/APPROVED/REJECTED), with optional
  per-field review comments and Proof-of-X score points.
- Flip an existing form or rotation request between statuses (simulate the reviewer flow over time).
  Approving a rotation request applies the merged slots to `ActiveMembers`, like the real admin flow.
- Set / clear the `ActiveMembers` row for an operator.
- Create a rotation request for an operator (honoring the single-open-review supersede invariant).
- Clear all `OperatorFile` rows for an operator.
- Wipe an operator (`reset`) so it can be re-seeded from scratch.
- Compose the above into named `scenario`s.
- Machine-readable `--json` on every data-emitting command.
- A documented, repeatable way to **sync the vendored schema when survey-api changes.**

## Non-goals

- **Not** for shared/staging environments or real-data ops. Local dev only.
- **Not** driving the HTTP API or booting Nest — direct Prisma writes to the survey-api DB only.
- **Not** running migrations. The survey-api-owned Postgres already has all constraints applied; the
  vendored schema is used **only to generate a typed client**, never to `prisma migrate`.
- **Not** producing valid signatures. Signatures are placeholders; never validated on read, never
  exposed in responses.
- **Not published to npm.** Private package (needs a live DB; Prisma runtime does not bundle cleanly).
  Runs within the monorepo via `tsx`.
- No read/`inspect` command; `OperatorFile` clear-only (no seed) in v1. No `Setup` seeding either:
  survey-api's own Prisma client auto-assigns `Setup.index` and writes `SetupSnapshot`s via client
  extensions the vendored client lacks — a future `setup` command must replicate that itself.

## Placement, invocation & toolchain

- **Package:** `tools/survey` → `@sm-lab/survey`, `"private": true`, `type: module`, `engines.node >=24`.
- **Bin / run:** `sm-survey` → runs the CLI via `tsx src/cli.ts` (dev-only tool, no bundled Prisma
  runtime). A package script `"survey": "tsx src/cli.ts"` and a root convenience make
  `pnpm --filter @sm-lab/survey survey <group> <cmd>` (or `pnpm survey …` if a root script is added).
- **Build:** a `tsdown` entry is present for turbo-consistency (`pnpm turbo run build`), externalizing
  `@prisma/client`, `@prisma/adapter-pg`, and `pg`; the CLI's real run path is `tsx`, not `dist`.
- **Deps (add to `catalog:` in `pnpm-workspace.yaml`):** `prisma` (dev, generator/CLI), `@prisma/client`,
  `@prisma/adapter-pg`, `pg`, `@types/pg` (dev), `vitest-mock-extended` (dev). Reuse catalog `commander`,
  `dotenv`, `tsx`, `tsdown`, `vitest`, `typescript`, `@types/node`.
- **tsconfig:** relative-extends `../../packages/config/tsconfig.lib.json` (per the tsdown loader
  gotcha); `include` covers `src/**` + `test/**`.
- **Config:** `DATABASE_URL` read from env (dotenv), pointing at the developer's local survey-api
  Postgres. The CLI builds a `PrismaClient` with a `PrismaPg` adapter over a `pg` pool.

## Command surface

Grouped by entity. Every data-emitting command accepts `--json`. Random addresses/signatures are
generated for anything not supplied and echoed back in the output.

```
sm-survey ics seed        --operator <id> [--status review|approved|rejected]
                          [--main-address 0x..] [--twitter ..] [--discord ..]
                          [--additional 0x.. ...] [--comment field=text ...] [--points field=n ...]
sm-survey ics review      --main-address 0x.. --status .. [--comment field=text ...]
                          [--points field=n ...] [--reviewer 0x..] [--issued]  # issued: approved-only

sm-survey idvtc seed      --operator <id> [--status ..] [--main-address 0x..]
                          [--member 0x.. ...] [--bind]  # bind: issued + boundToNodeOperatorId, implies approved
sm-survey idvtc review    --main-address 0x.. --status .. [--comment field=text ...] [--reviewer 0x..]

sm-survey members set     --operator <id> [--member 0x.. ...]    # up to 4; missing slots random
sm-survey members clear   --operator <id>

sm-survey rotation create --operator <id> [--slot 0x.. ...] [--submitter 0x..]
                          # pads to 4 slots when the operator has no ActiveMembers row (first-init rule)
sm-survey rotation review --operator <id> --status .. [--comment field=text ...] [--reviewer 0x..]
                          # approved → mergeSlots + ActiveMembers upsert (same transaction)

sm-survey files clear     --operator <id>

sm-survey reset           --operator <id> [--main-address 0x..]  # wipe (see Invariants §5)
sm-survey scenario <name> --operator <id>                         # composite
```

**Keying asymmetry (inherent to the schema):** `ics/idvtc review` are keyed by `--main-address`
(forms have no operator column — ICS none at all); `rotation review`/`members`/`files`/`reset` are
keyed by `--operator`.

## Architecture — declarative registry

Mirrors `tools/recipes`' `defineCommand`/`buildProgram` seam:

- `SeedCommand` descriptor per operation: `{ group, name, summary, argument?, options, run(prisma, args) }`.
- `defineCommand(desc, prisma)` generates the commander command — per-option coercion (address →
  `getAddress` checksum, `field=value` → record, status → PSL enum name, positional → args prop),
  `--json` vs human print, `Error: …`/exit-1 on throw.
- `buildProgram(prisma, commands)` nests descriptors under group subcommands; `group: 'root'`
  descriptors (`reset`, `scenario`) attach at top level.
- The single injected `PrismaClient` is the sole test seam.

Leaf modules: `gen.ts` (address/signature generators), `prisma.ts` (standalone client via `PrismaPg`
over a `pg` pool), `commands/*.ts` (one file per group), `commands/index.ts` (`ALL_COMMANDS`).

## Invariant handling (correctness-critical)

The survey-api DB enforces these (raw-SQL migrations already applied); the CLI produces compliant
writes by copying the real service transactions — identical Prisma calls, so state is byte-consistent:

1. **Single-active form** (`ics/idvtc seed`): `$transaction` — `updateMany({outdated:true})` **then**
   `create` with nested `review.create`. Never trips the `WHERE outdated=false` partial-unique.
2. **Rotation supersede** (`rotation create`): `$transaction` — `updateMany({ superseded:false,
   status:{not:APPROVED} } → superseded:true)` then `create` the REVIEW row. Honors the
   one-open-review-per-operator partial-unique. When the operator has **no `ActiveMembers` row**, the
   request is padded to 4 slots (random addresses) — the real system requires all 4 on first-time
   init, so a shorter request would be unreachable and un-approvable.
3. **Rotation approve applies members** (`rotation review --status approved`): mirrors the real admin
   patch in one `$transaction` — `mergeSlots(active, request)` (patched slots win, null slots carry
   over from the current `ActiveMembers`, all 4 required on first init, duplicate addresses rejected;
   faithful port of survey-api `src/http/members/lib/merge-slots.ts`) → `activeMembers.upsert` → the
   request update (`status`, `reviewedAt`, comments). An APPROVED request whose slots aren't in
   `active_members` never exists in the real system.
4. **IDVTC bind** (`idvtc seed --bind`): sets `issued: true` **and** `boundToNodeOperatorId` — the
   real `initFromIdvtc` sets both atomically, and only on APPROVED forms. `--bind` therefore defaults
   the status to APPROVED and errors on an explicit non-approved status.
5. **ICS `issued`** is an explicit admin action, never implied by approval (it locks the review in the
   real admin UI): exposed as `ics review --issued`, valid only with `--status approved`.
6. **Slot address↔signature CHECK**: a slot with an address gets a non-null placeholder signature;
   both null otherwise. The 65-byte `placeholderSignature()` is used everywhere a signature column is
   seeded, including ICS additional addresses.
7. **Address casing**: lowercase on write (matches the services), else address-keyed lookups miss.
8. **`reset`** (single `$transaction`): operator-keyed tables deleted by `nodeOperatorId`
   (`ActiveMembers`, `RotationRequest`, `OperatorFile`, `Setup`, `SetupSnapshot`, `Contacts`,
   `Experience`, `HowDidYouLearnCsm`, `Delegate`) + `IdvtcForm` where `boundToNodeOperatorId=<id>`.
   Address-keyed `IcsForm`/`IdvtcForm` deleted **only with `--main-address`**; when omitted, report
   the skip. Reviews cascade via `onDelete: Cascade`.
9. **`--reviewer 0x..`**: create-if-missing an `AdminUser`, link `lastReviewerId` (+ `reviewedAt` for
   rotation); omitted → null (real reviews always carry an admin id; the column is nullable and the
   admin UI tolerates null).

## Testing

Hermetic, vitest (sm-lab's runner):

- `buildProgram(mockDeep<PrismaClient>())` from `vitest-mock-extended`. Parse an argv line, assert the
  exact Prisma calls (e.g. `updateMany({outdated:true})` before `create`; nested `review.create.status`).
- Coercion tests (`field=value`, checksum rejection, `--json` single-value output).
- Invariant tests (rotation supersede; `reset` skip-report without `--main-address`).
- No DB, no network. Generators seeded/stubbed for determinism.

## Syncing with survey-api (schema drift)

The vendored `schema.prisma` is a **generate-only copy** of survey-api's. When survey-api's schema
changes, re-vendor and regenerate. Mirrors the `@sm-lab/receipts` `refresh.ts` pattern.

- **Source of truth:** survey-api's `prisma/schema.prisma`. Vendored to `tools/survey/prisma/schema.prisma`.
- **What differs in the vendored copy:** only the `generator client` block — output to
  `../src/generated/prisma`, `moduleFormat = "esm"`, `runtime = "nodejs"`, `importFileExtension = ""`;
  and `datasource db` gains `url = env("DATABASE_URL")`. The `model`/`enum` bodies are copied verbatim.
- **`refresh.ts`** (human-run, `tsx src/refresh.ts`): given a survey-api checkout path
  (`--source <path>` or `SURVEY_API_PATH` env), it (1) reads the source `schema.prisma`, (2) strips the
  source `generator`/`datasource` blocks and prepends sm-lab's, (3) writes `tools/survey/prisma/schema.prisma`,
  (4) runs `prisma generate`, (5) writes `prisma/manifest.json` recording provenance
  (`{ sourceRef, sourceCommit, refreshedAt }` — commit read via `git -C <source> rev-parse HEAD`).
- **Guard:** refresh refuses if the source working tree is dirty (uncommitted schema) unless `--force`,
  so the recorded commit is meaningful.
- **Generated client is git-ignored** (`tools/survey/src/generated/`), rebuilt by `refresh` and by a
  `generate` script (`prisma generate`) wired into the package's `prebuild`/postinstall.
- **Drift visibility:** `manifest.json` (committed) shows which survey-api commit the client matches;
  a CLAUDE.md note points here. A stretch (deferred): a CI check that re-runs generate and diffs.

## Scenarios (starter set)

`sm-survey scenario <name> --operator <id>` composes the primitive writers:
- `approved-ics` — one ICS form, APPROVED.
- `idvtc-with-members` — an APPROVED bound (`issued` + `boundToNodeOperatorId`) IDVTC form + the
  matching `ActiveMembers` row holding the **same 4 cluster addresses** (generated once, used in
  both — mirrors `initFromIdvtc`).
- `pending-rotation` — active members set + one rotation request in REVIEW.

## Risks & mitigations

- **Schema drift** → the `refresh.ts` + `manifest.json` provenance flow (above); CLAUDE.md pointer.
- **Prisma runtime doesn't bundle** → package is private + runs via `tsx`; build externalizes prisma/pg.
- **Orphan ICS forms on `reset`** → explicit `--main-address` split + skip report.
- **Invariant divergence** → identical Prisma calls to the services; DB constraints are the backstop;
  invariant unit tests.

## Documentation

- `tools/survey/README.md` — usage + the sync/refresh procedure.
- A `@sm-lab/survey` bullet in the root CLAUDE.md Status section, incl. the sync pointer.
- A changeset is **not** required (private, unpublished package).
