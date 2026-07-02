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

/** Real Pinata host. Used when PINATA_* credentials are set but IPFS_API_URL is unset. */
export const DEFAULT_IPFS_API_URL = 'https://api.pinata.cloud';

/** Local @sm-lab/ipfs default — the fallback when no IPFS_API_URL or Pinata creds are set. */
export const LOCAL_IPFS_API_URL = 'http://127.0.0.1:5001';

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
