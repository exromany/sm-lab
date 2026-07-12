import { UPSTREAM_TIMEOUT_MS } from '../types';
import type { GatewayHealthEntry, GatewayOutcome } from '../types';

/** The result of resolving a CID against a real IPFS gateway. */
export interface UpstreamResult {
  ok: boolean;
  status: number;
  contentType: string;
  data: Uint8Array;
}

/** A single attempt's result plus its classified outcome (internal to the fetcher). */
interface Attempt extends UpstreamResult {
  outcome: GatewayOutcome;
}

/**
 * Fetches a CID from a real upstream IPFS gateway. INJECTABLE: the app factory accepts a
 * function of this shape (defaulting to the real one below), so tests can stub the network
 * out entirely. Never throws — failures map to 502 (connection) / 504 (timeout) results.
 *
 * The production fetcher also exposes {@link GatewayHealthEntry per-gateway health} via
 * `snapshot()`; injected stubs omit it (the property is optional), so callers must guard.
 */
export interface UpstreamFetcher {
  (cid: string): Promise<UpstreamResult>;
  /** Per-gateway health in chain (try) order. Present only on the production fetcher. */
  snapshot?: () => GatewayHealthEntry[];
}

/** Mutable tally for one gateway, accumulated across the fetcher's lifetime. */
interface Counts {
  attempts: number;
  hits: number;
  misses: number;
  timeouts: number;
  unreachable: number;
}

/**
 * Builds the production fetcher over one or more gateway base URLs. Multiple gateways form a
 * fallback chain: each is tried in order and the first 2xx result wins; a miss or failure
 * (404, unreachable, timeout) falls through to the next. When every gateway fails the last
 * failure is returned. Never throws — failures map to 502 (connection) / 504 (timeout).
 *
 * Each attempt is tallied into a per-gateway counter, surfaced via {@link UpstreamFetcher.snapshot}.
 */
export function createUpstreamFetcher(gateway: string | readonly string[]): UpstreamFetcher {
  const bases = (typeof gateway === 'string' ? [gateway] : gateway)
    .map((g) => g.replace(/\/+$/, ''))
    .filter(Boolean);
  // Insertion order preserved → snapshot() reports gateways in chain (try) order.
  const counts = new Map<string, Counts>(
    bases.map((b) => [b, { attempts: 0, hits: 0, misses: 0, timeouts: 0, unreachable: 0 }]),
  );

  const fetcher: UpstreamFetcher = async (cid) => {
    let lastFailure: UpstreamResult | undefined;
    for (const base of bases) {
      // Sequential by necessity: a fallback chain only tries the next gateway on a miss —
      // parallelizing would defeat the point (and hammer every gateway for every store-miss).
      // eslint-disable-next-line no-await-in-loop -- see above
      const attempt = await fetchFromGateway(base, cid);
      record(counts.get(base), attempt.outcome);
      if (attempt.ok) return attempt;
      lastFailure = attempt;
    }
    return lastFailure ?? noGatewayConfigured(cid);
  };

  fetcher.snapshot = () => bases.map((base) => summarize(base, counts.get(base)));
  return fetcher;
}

/** Maps an outcome to the `Counts` field it increments. */
const OUTCOME_FIELD: Record<GatewayOutcome, keyof Omit<Counts, 'attempts'>> = {
  hit: 'hits',
  miss: 'misses',
  timeout: 'timeouts',
  unreachable: 'unreachable',
};

/** Bumps the attempt tally for one outcome (synchronous → no torn counts under concurrency). */
function record(c: Counts | undefined, outcome: GatewayOutcome): void {
  if (!c) return;
  c.attempts += 1;
  c[OUTCOME_FIELD[outcome]] += 1;
}

/** Derives a gateway's health verdict + human note from its raw counts. */
function summarize(gateway: string, c: Counts | undefined): GatewayHealthEntry {
  const { attempts, hits, misses, timeouts, unreachable } = c ?? {
    attempts: 0,
    hits: 0,
    misses: 0,
    timeouts: 0,
    unreachable: 0,
  };
  const reached = hits > 0 || misses > 0;
  const healthy = attempts === 0 || reached;
  return { gateway, attempts, hits, misses, timeouts, unreachable, healthy, note: note() };

  function note(): string | undefined {
    if (attempts === 0) return 'untested';
    if (!healthy) {
      if (timeouts > 0 && unreachable === 0) return 'all timed out';
      if (unreachable > 0 && timeouts === 0) return 'unreachable';
      return 'no contact';
    }
    if (hits === 0) return 'reachable, no hits';
    return undefined;
  }
}

/** Fetches a CID from a single gateway, mapping transport failures to 502/504 results. */
async function fetchFromGateway(base: string, cid: string): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/ipfs/${cid}`, { signal: controller.signal });
    const data = new Uint8Array(await res.arrayBuffer());
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      data,
      outcome: res.ok ? 'hit' : 'miss',
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      contentType: 'application/json',
      data: new TextEncoder().encode(
        JSON.stringify({
          error: isTimeout ? 'upstream gateway timed out' : 'upstream gateway unreachable',
          gateway: base,
          cid,
        }),
      ),
      outcome: isTimeout ? 'timeout' : 'unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Guards the degenerate empty-chain case (no gateways configured at all). */
function noGatewayConfigured(cid: string): UpstreamResult {
  return {
    ok: false,
    status: 502,
    contentType: 'application/json',
    data: new TextEncoder().encode(
      JSON.stringify({ error: 'no upstream gateway configured', cid }),
    ),
  };
}
