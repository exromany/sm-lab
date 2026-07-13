/**
 * IPFS pinning client — Pinata-compatible, with an env-switchable endpoint.
 *
 * Why not `@pinata/sdk` directly? The installed v2 SDK hardcodes
 * `baseUrl = 'https://api.pinata.cloud'` (see its `src/constants.ts`); its `PinataConfig`
 * exposes only API keys / JWT, no host override. To target `@sm-lab/ipfs` locally we
 * need a configurable base URL, so this is a thin `fetch` client hitting the exact same
 * `/pinning/pinJSONToIPFS` route the mock implements. Point it at real Pinata in test-infra
 * by supplying PINATA_* credentials (no need to set IPFS_API_URL when using Pinata).
 *
 * Default resolution (local-first):
 *   explicit apiUrl → IPFS_API_URL env → Pinata (if PINATA_* set) → local @sm-lab/ipfs
 */

import { CID } from 'multiformats/cid';

/** Real Pinata host. Used when PINATA_* credentials are set but IPFS_API_URL is unset. */
export const DEFAULT_IPFS_API_URL = 'https://api.pinata.cloud';

/** Local @sm-lab/ipfs default — the fallback when no IPFS_API_URL or Pinata creds are set. */
export const LOCAL_IPFS_API_URL = 'http://127.0.0.1:5001';

/** Real Pinata public gateway — the read fallback when the pin origin is the Pinata API host. */
export const DEFAULT_IPFS_GATEWAY_URL = 'https://gateway.pinata.cloud';

export interface IpfsClientOptions {
  /** Base URL of the pinning service. Defaults to `IPFS_API_URL` env, then real Pinata. */
  apiUrl?: string;
  /** Pinata API key (header `pinata_api_key`). Mocks may ignore it. */
  apiKey?: string;
  /** Pinata API secret (header `pinata_secret_api_key`). Mocks may ignore it. */
  apiSecret?: string;
  /** Pinata JWT (header `Authorization: Bearer …`). Alternative to key/secret. */
  jwt?: string;
}

/** Shape of a Pinata `pinJSONToIPFS` success response. */
export interface PinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/**
 * Resolve the pinning base URL: explicit apiUrl → IPFS_API_URL env → Pinata (if PINATA_* set)
 * → local @sm-lab/ipfs (http://127.0.0.1:5001).
 */
export function resolveIpfsApiUrl(apiUrl?: string): string {
  // Treat empty string (e.g. `IPFS_API_URL=`) as unset so it falls through to the defaults.
  const explicit = apiUrl || process.env.IPFS_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (hasPinataCredentials()) return DEFAULT_IPFS_API_URL;
  return LOCAL_IPFS_API_URL;
}

/**
 * Resolve the base URL for IPFS *reads* (`GET /ipfs/:cid`): explicit `gatewayUrl` →
 * `IPFS_GATEWAY_URL` env → the pin origin (`resolveIpfsApiUrl` — exactly right for the local
 * `@sm-lab/ipfs` mock, which serves pinning AND `/ipfs/:cid` on one port) → the public Pinata
 * gateway when the pin origin is the Pinata API host (`api.pinata.cloud` does NOT serve `/ipfs`).
 */
export function resolveIpfsGatewayUrl(gatewayUrl?: string): string {
  const explicit = gatewayUrl || process.env.IPFS_GATEWAY_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const pin = resolveIpfsApiUrl();
  return pin === DEFAULT_IPFS_API_URL ? DEFAULT_IPFS_GATEWAY_URL : pin;
}

export interface FetchIpfsOptions {
  /** Gateway base URL. Defaults per {@link resolveIpfsGatewayUrl}. */
  gatewayUrl?: string;
  /** Caller's bypass hint woven into the unreachable error (e.g. `'pass --from-cid <cid>'`). */
  skipHint?: string;
}

/**
 * Fetch + JSON-parse a pinned object by CID via `GET {gateway}/ipfs/{cid}`. The read counterpart
 * of {@link pinJsonToIpfs}, mirroring its discipline: trailing-slash-stripped join, explicit
 * `Response` typing (no DOM lib), and an actionable throw. A thrown fetch (connection refused /
 * DNS / timeout) or a non-2xx surfaces an error naming the gateway + the caller's `skipHint`.
 */
export async function fetchIpfsJson(cid: string, opts: FetchIpfsOptions = {}): Promise<unknown> {
  const base = resolveIpfsGatewayUrl(opts.gatewayUrl);
  const url = `${base}/ipfs/${cid}`;
  const hint = opts.skipHint ?? 'supply the addresses another way';
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      `@sm-lab/merkle: cannot reach the IPFS gateway at ${base} to read ${cid}.\n` +
        `Do one of:\n` +
        `  • start the local mock:  npx @sm-lab/ipfs serve      (or: pnpm stack:up)\n` +
        `  • point elsewhere:       set IPFS_GATEWAY_URL=<url>\n` +
        `  • ${hint}`,
    );
  }
  if (!res.ok) {
    // Reached only for a syntactically valid CID the gateway couldn't serve (not pinned / gone).
    // A placeholder / non-CID never gets here — callers gate on isLikelyCid first.
    throw new Error(
      `@sm-lab/merkle: GET ${url} failed: ${res.status} ${res.statusText}.\n` +
        `The CID's content isn't served by this gateway (not pinned, or wrong gateway).\n` +
        `  • point elsewhere: set IPFS_GATEWAY_URL=<url>\n` +
        `  • ${hint}`,
    );
  }
  return (await res.json()) as unknown;
}

/**
 * True if `value` is a syntactically valid IPFS CID (v0 `Qm…` or v1 `bafy…`). Uses the same
 * `CID.parse` check the `@sm-lab/ipfs` gateway applies before proxying, so a placeholder such as a
 * gate's empty-tree sentinel (`"someCid"`) reads as `false`. Callers use this to distinguish a real
 * pinned tree (fetch it) from an unset/placeholder one (treat as empty) before calling
 * {@link fetchIpfsJson} — a real allowlist is always pinned under a valid CID.
 */
export function isLikelyCid(value: string): boolean {
  try {
    CID.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** Read pinning config from the environment (credentials + endpoint switch). */
export function ipfsOptionsFromEnv(): IpfsClientOptions {
  return {
    apiUrl: process.env.IPFS_API_URL,
    apiKey: process.env.PINATA_API_KEY,
    apiSecret: process.env.PINATA_API_SECRET,
    jwt: process.env.PINATA_JWT,
  };
}

/** True when enough credentials are present to talk to real Pinata. */
export function hasPinataCredentials(opts: IpfsClientOptions = ipfsOptionsFromEnv()): boolean {
  return Boolean(opts.jwt || (opts.apiKey && opts.apiSecret));
}

/**
 * True when a non-default pinning endpoint is configured — i.e. `IPFS_API_URL` points
 * somewhere other than real Pinata (typically a local `@sm-lab/ipfs`). Such endpoints
 * accept unauthenticated pins, so credentials are not required to upload to them.
 */
export function hasCustomIpfsEndpoint(opts: IpfsClientOptions = ipfsOptionsFromEnv()): boolean {
  const raw = (opts.apiUrl ?? '').replace(/\/+$/, '');
  return raw.length > 0 && raw !== DEFAULT_IPFS_API_URL;
}

/**
 * Whether `make`/`tree` should attempt to pin. With the local-first default there is always a
 * usable target, so this returns `true` unless an explicit `IPFS_API_URL` points directly at
 * real Pinata without credentials (that edge case cannot pin, so we still return `false` there).
 * Use the CLI's `--no-upload` / `MakeOptions.noUpload` to explicitly skip pinning.
 */
export function shouldAttemptPin(opts: IpfsClientOptions = ipfsOptionsFromEnv()): boolean {
  const raw = (opts.apiUrl ?? process.env.IPFS_API_URL ?? '').replace(/\/+$/, '');
  if (raw === DEFAULT_IPFS_API_URL && !hasPinataCredentials(opts)) return false;
  // All other cases: custom endpoint (including no env, which falls through to LOCAL) or Pinata creds.
  return true;
}

/**
 * Assert a pin can succeed, throwing actionable guidance otherwise. Three outcomes:
 *  - `IPFS_API_URL` points at real Pinata with no credentials → throw (can't authenticate).
 *  - Pinata with credentials → return (assume reachable; a token can't be cheaply verified).
 *  - local / custom endpoint → probe reachability; a thrown fetch (connection refused / DNS /
 *    timeout) means down → throw. Any HTTP response (even a 404) counts as reachable.
 *
 * `skipHint` is the caller's escape hatch (e.g. `'pass --cid <cid>'`), woven into both messages so
 * the recipe can tell the user how to bypass pinning entirely. Call this before `pinJsonToIpfs`.
 */
export async function assertPinnable(
  skipHint = 'supply a precomputed CID',
  opts: IpfsClientOptions = ipfsOptionsFromEnv(),
): Promise<void> {
  const target = resolveIpfsApiUrl(opts.apiUrl);
  if (!shouldAttemptPin(opts)) {
    // shouldAttemptPin rejects exactly one case: IPFS_API_URL == real Pinata, no credentials.
    throw new Error(
      `@sm-lab/merkle: IPFS_API_URL points at Pinata (${target}) but no credentials are set.\n` +
        `Do one of:\n` +
        `  • set PINATA_JWT   (or PINATA_API_KEY + PINATA_API_SECRET)\n` +
        `  • unset IPFS_API_URL to use the local mock:  npx @sm-lab/ipfs serve\n` +
        `  • ${skipHint}`,
    );
  }
  if (hasPinataCredentials(opts)) return; // Pinata with creds — assume reachable.
  if (await isReachable(target)) return;
  throw new Error(
    `@sm-lab/merkle: cannot reach the IPFS pinning service at ${target}.\n` +
      `Do one of:\n` +
      `  • start the local mock:  npx @sm-lab/ipfs serve      (or: pnpm stack:up)\n` +
      `  • use Pinata:            set PINATA_JWT  (or PINATA_API_KEY + PINATA_API_SECRET)\n` +
      `  • point elsewhere:       set IPFS_API_URL=<url>\n` +
      `  • ${skipHint}`,
  );
}

/**
 * True when `url` answers any HTTP response within `timeoutMs`. A 404/405 still counts —
 * reachability ≠ correctness; we only need proof something is listening. A thrown fetch
 * (connection refused / DNS failure / timeout) is the "down" signal. Inlined here (single
 * consumer) rather than promoted to @sm-lab/core — YAGNI until a second caller needs it.
 */
async function isReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

function buildAuthHeaders(opts: IpfsClientOptions): Record<string, string> {
  if (opts.jwt) {
    return { Authorization: `Bearer ${opts.jwt}` };
  }
  if (opts.apiKey && opts.apiSecret) {
    return {
      pinata_api_key: opts.apiKey,
      pinata_secret_api_key: opts.apiSecret,
    };
  }
  return {};
}

/**
 * Pin a JSON object and return its CID. POSTs the Pinata `pinJSONToIPFS` envelope
 * (`{ pinataContent, pinataMetadata }`) so both real Pinata and `@sm-lab/ipfs` accept it.
 */
export async function pinJsonToIpfs(
  data: unknown,
  metadataName: string,
  opts: IpfsClientOptions = ipfsOptionsFromEnv(),
): Promise<string> {
  const url = `${resolveIpfsApiUrl(opts.apiUrl)}/pinning/pinJSONToIPFS`;
  const body = JSON.stringify({
    pinataContent: data,
    pinataMetadata: { name: metadataName },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(opts) },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `pinJSONToIPFS failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const json = (await res.json()) as Partial<PinResponse>;
  if (!json.IpfsHash) {
    throw new Error(`pinJSONToIPFS: response missing IpfsHash (${JSON.stringify(json)})`);
  }
  return json.IpfsHash;
}
