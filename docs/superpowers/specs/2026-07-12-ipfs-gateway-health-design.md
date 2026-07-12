# IPFS upstream-gateway health counters

**Date:** 2026-07-12
**Package:** `@sm-lab/ipfs`
**Status:** approved, implementing

## Problem

The upstream fallback chain (`createUpstreamFetcher`, added in `d0c7c36`) is deliberately
silent: each gateway is tried in order, the first 2xx wins, and any miss/timeout/unreachable
falls through to the next with nothing recorded. A gateway that _always_ fails is therefore
invisible as long as a later gateway in the chain answers. `/admin/status` reports only the
configured chain as a comma-joined display string — no per-gateway health. There is no way to
tell an operator "gateway X is broken".

## Goal

Passive, per-gateway health counters that reflect real proxied traffic, surfaced via
`/admin/status` and the `status` CLI, so a permanently-failing gateway is observable.

## Broken semantics (decided)

Per attempt the fetcher already distinguishes four outcomes:

- **hit** — 2xx response
- **miss** — reachable but non-2xx (e.g. 404; the gateway simply didn't hold that CID)
- **timeout** — request aborted at `UPSTREAM_TIMEOUT_MS` (mapped to 504)
- **unreachable** — connection/transport failure (mapped to 502)

Verdict rule (**transport failures only**):

> A gateway is **broken (✗)** only when `attempts > 0 && hits == 0 && misses == 0` — i.e. it
> made attempts but never once produced a real HTTP response (every attempt timed out or was
> unreachable). Any hit **or** miss means it was reached at least once → **healthy (✓)**. Zero
> attempts → **untested (—)**, not broken.

Rationale: a 404 means the gateway is up and answering; it just lacks that content, which is
normal and expected in a fallback chain. Only a total absence of contact indicates the gateway
itself is down. Counters are cumulative-since-boot, so a gateway that answered once long ago
then started timing out reads `✓` by verdict, but its climbing `timeouts` count still exposes
the degradation in the raw numbers. Verdict answers "is it stone dead"; counts answer "is it
degrading".

## Design

### 1. Stats accumulator inside the fetcher (`server/upstream.ts`)

`fetchFromGateway` already computes the taxonomy in its `res.ok` / `AbortError` / other-catch
branches. Classify each attempt into a `GatewayOutcome` and tally it into a per-base counter
map held in the `createUpstreamFetcher` closure.

```ts
export type GatewayOutcome = 'hit' | 'miss' | 'timeout' | 'unreachable';

export interface GatewayHealthEntry {
  gateway: string;
  attempts: number;
  hits: number;
  misses: number;
  timeouts: number;
  unreachable: number;
  healthy: boolean;   // false ONLY when attempts>0 && hits==0 && misses==0
  note?: string;      // 'untested' | 'all timed out' | 'unreachable' | 'reachable, no hits'
}
```

`note` is a short human hint derived from the counts (best-effort, for the CLI render):
- `attempts === 0` → `'untested'`
- broken and `timeouts > 0 && unreachable === 0` → `'all timed out'`
- broken and `unreachable > 0 && timeouts === 0` → `'unreachable'`
- broken otherwise → `'no contact'`
- healthy and `hits === 0` → `'reachable, no hits'`
- healthy and `hits > 0` → omitted

### 2. Expose without breaking callers

Today `UpstreamFetcher = (cid) => Promise<UpstreamResult>` — a bare function the gateway route
calls directly. Widen it to a **callable interface with an optional `snapshot?()` method**:

```ts
export interface UpstreamFetcher {
  (cid: string): Promise<UpstreamResult>;
  /** Per-gateway health snapshot in chain order; absent on injected stubs. */
  snapshot?: () => GatewayHealthEntry[];
}
```

The production fetcher attaches `snapshot`; injected test stubs (plain async fns) omit it and
remain valid. `server/gateway.ts` is unchanged (still calls the fetcher as a function).

### 3. Wire into status (`server/app.ts`)

`getStatus` calls `fetchUpstream.snapshot?.()`. When present, the status object gains a
`gateways: GatewayHealthEntry[]` field. The existing `gateway: gateways.join(', ')` string
stays for back-compat. Stub-injected apps report no `gateways` — old behavior preserved.

### 4. Status CLI render (`cli/status.ts`)

When `data.gateways` is present, render a per-gateway table with a ✓/✗/— verdict; keep the
one-line `Gateway:` fallback otherwise. `--json` emits the raw status object (including
`gateways`) unchanged — core's `createStatusCommand` owns the `--json` path.

## Properties

- **Ephemeral** — counters live in memory, reset on restart; **not** written to the `--state`
  file (that persists pins; health is runtime observability). No reset endpoint (YAGNI).
- **Concurrency-safe** — increments are synchronous `++` after each `await`; single-threaded
  JS, no torn counts.
- **Order-preserving** — snapshot lists gateways in chain (try) order.

## Testing (`server/ipfs.test.ts`)

Hermetic, no network:
- Drive the real `createUpstreamFetcher` with a stubbed `fetch` yielding 2xx / 404 / abort /
  throw per base; assert the `snapshot()` tally and the `healthy`/`note` verdict for each of:
  all-hits, all-timeouts (broken), all-404 (healthy, no hits), mixed.
- Assert fallback still returns the first 2xx and that both the failed first gateway and the
  winning second gateway are tallied.
- Assert `/admin/status` surfaces `gateways` with the real fetcher.
- Assert a stub-injected app omits `gateways` (back-compat).

## Files

- `apps/ipfs/src/server/upstream.ts` — counters + `UpstreamFetcher` interface widening
- `apps/ipfs/src/server/app.ts` — status wiring
- `apps/ipfs/src/cli/status.ts` — render
- `apps/ipfs/src/server/ipfs.test.ts` — coverage
- `.changeset/*` — patch changeset

No new files.

## Out of scope / deferred

- Active health-probe command / `/admin/health` endpoint (separate feature).
- `X-Ipfs-Gateway` provenance header.
- Persisting counters across restarts; a counter-reset endpoint.
