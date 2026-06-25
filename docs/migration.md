# Migration plan

Each step is independently shippable — the repo is usable after every one. Per-package
mechanics live in each package's own README; this is the order and the cross-cutting work.

| # | Step | Outcome |
| --- | --- | --- |
| 1 | **Scaffold** ✅ done | pnpm + turbo + changesets + oxlint + tsconfig base + 4 buckets |
| 2 | **cl-mock** ← `csm-test-cl` ✅ done | moved to `apps/cl-mock`, `tsc`→tsdown, `csm-cl-mock` bin kept, ESM-ified, first Vitest tests, build/types/test/lint all green and smoke-tested |
| 3 | **merkle** ← `csm-test-tree` ✅ done | moved to `tools/merkle`, `ts-node`→tsdown + ESM. **Trimmed to build + pin**: `ics`/`strikes` build a tree, pin via `IPFS_API_URL` (mock or real Pinata, no creds for the mock), print root + CID (`-o` writes a handoff file). The `set`/on-chain half (`cast`, `DEPLOY_JSON_PATH`, deploy-address loading) was **removed** — it moves to receipts. 27 Vitest tests, all gates green |
| 4 | **core** ✅ done | extracted server scaffold + shutdown, `/admin/status` + `/admin/shutdown` + `readPackageVersion`, and `status`/`stop` CLI factories + `resolveUrl`/`formatUptime` into `@csm-lab/core` (bundled via `deps.alwaysBundle`, not published). cl-mock + ipfs-mock consume it; 10 core tests; 58 tests total green. Domain validators + merkle's `cast` deliberately left local (YAGNI) |
| 5 | **ipfs-mock** ✅ done | Pinata-compatible pin API + `/ipfs/:cid` gateway with deterministic CIDv1 + upstream proxy (default `dweb.link`, env/flag override), `--persist`, 13 hermetic tests, Docker, all gates green |
| 6 | **receipts** | snapshots + `refresh.ts`; retire receipts from the contracts repo. **Also absorbs the on-chain "set" work trimmed out of merkle** — resolving deploy addresses and pushing `{ treeRoot, treeCid }` to VettedGate/CSStrikes via `cast` (consumes merkle's `-o` output) |
| 7 | **CI/CD** | turbo PR checks (done) → changesets release (done) → Docker publish for `apps/*` |

## Importing git history

These are small, mostly-personal repos. Two options per repo:

- **Keep history:** `git subtree add --prefix=apps/cl-mock <csm-test-cl-remote> main`, or
  `git filter-repo` to rewrite paths before merging.
- **Copy:** if history isn't precious, just copy `src/` and start fresh.

## Bootstrapping the repo into git

This directory is not yet a git repo. To start:

```bash
cd csm-lab
git init && git add -A && git commit -m "chore: scaffold csm-lab monorepo"
pnpm install          # resolves catalog: + workspace: links, writes lockfile
pnpm changeset init   # (config already present)
```

> Dependency versions in `package.json`/`pnpm-workspace.yaml` are sensible starting ranges;
> `pnpm install` will resolve and lock them. Run `pnpm up --latest -r` to pull current.
