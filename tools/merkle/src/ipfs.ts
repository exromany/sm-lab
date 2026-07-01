/**
 * IPFS pinning client — Pinata-compatible, with an env-switchable endpoint.
 *
 * Why not `@pinata/sdk` directly? The installed v2 SDK hardcodes
 * `baseUrl = 'https://api.pinata.cloud'` (see its `src/constants.ts`); its `PinataConfig`
 * exposes only API keys / JWT, no host override. To target `@sm-lab/ipfs-mock` locally we
 * need a configurable base URL, so this is a thin `fetch` client hitting the exact same
 * `/pinning/pinJSONToIPFS` route the mock implements. Point it at real Pinata in test-infra
 * by leaving `IPFS_API_URL` unset (defaults to the real host) and supplying credentials.
 */

/** Real Pinata host — the default when `IPFS_API_URL` is unset. */
export const DEFAULT_IPFS_API_URL = 'https://api.pinata.cloud';

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

/** Resolve the pinning base URL from explicit option → env → real Pinata default. */
export function resolveIpfsApiUrl(apiUrl?: string): string {
  // Treat empty string (e.g. `IPFS_API_URL=`) as unset so it falls through to the default.
  const candidate = apiUrl || process.env.IPFS_API_URL || DEFAULT_IPFS_API_URL;
  return candidate.replace(/\/+$/, '');
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
 * somewhere other than real Pinata (typically a local `@sm-lab/ipfs-mock`). Such endpoints
 * accept unauthenticated pins, so credentials are not required to upload to them.
 */
export function hasCustomIpfsEndpoint(opts: IpfsClientOptions = ipfsOptionsFromEnv()): boolean {
  const raw = (opts.apiUrl ?? '').replace(/\/+$/, '');
  return raw.length > 0 && raw !== DEFAULT_IPFS_API_URL;
}

/**
 * Whether `make`/`tree` should attempt to pin: yes if a custom endpoint is set (no auth needed,
 * e.g. the local mock) OR real-Pinata credentials are present. Lets local mock runs upload
 * without credentials while still skipping gracefully when nothing is configured.
 */
export function shouldAttemptPin(opts: IpfsClientOptions = ipfsOptionsFromEnv()): boolean {
  return hasCustomIpfsEndpoint(opts) || hasPinataCredentials(opts);
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
 * (`{ pinataContent, pinataMetadata }`) so both real Pinata and `@sm-lab/ipfs-mock` accept it.
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
