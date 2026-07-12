export const DEFAULT_PORT = 5001;
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Primary public IPFS gateway for store-miss CIDs. Chosen because dweb.link is the Protocol
 * Labs subdomain gateway — same content as ipfs.io, but it serves from `<cid>.ipfs.dweb.link`
 * paths AND honors plain `/ipfs/:cid`, and it is the gateway js-ipfs/helia default to.
 */
export const DEFAULT_GATEWAY = 'https://dweb.link';

/**
 * Upstream gateway fallback chain, tried in order: the first 2xx wins; a miss or failure
 * (404, unreachable, timeout) falls through to the next. dweb.link leads; ipfs.io backs it up
 * so a single flaky gateway doesn't sink a store-miss read. Override the whole chain via
 * `IPFS_UPSTREAM_GATEWAY` or `serve --gateway` (comma-separated for multiple).
 */
export const DEFAULT_GATEWAYS = [DEFAULT_GATEWAY, 'https://ipfs.io'] as const;

/** How long we wait on the upstream gateway before giving up with a 504. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/** A pinned object: the raw bytes plus the metadata Pinata echoes back. */
export interface Pin {
  cid: string;
  size: number;
  /** Stored content bytes. */
  data: Uint8Array;
  /** Best-effort MIME type (defaults to application/octet-stream). */
  contentType: string;
  /** ISO-8601 timestamp of when the pin was created. */
  pinnedAt: string;
  /** Optional user metadata (Pinata `pinataMetadata.name` etc.). */
  name?: string;
}

/** The Pinata pin-response shape (`pinJSONToIPFS` / `pinFileToIPFS`). */
export interface PinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/** CIDv1 + raw codec (0x55). A real, valid CID, fully deterministic for given bytes. */
export const RAW_CODEC = 0x55;

/** How a single upstream-gateway attempt turned out. */
export type GatewayOutcome = 'hit' | 'miss' | 'timeout' | 'unreachable';

/**
 * Cumulative-since-boot health of one gateway in the fallback chain, as reported by
 * `/admin/status`. Part of the wire contract (produced by the fetcher, consumed by the CLI).
 */
export interface GatewayHealthEntry {
  gateway: string;
  /** Total attempts made against this gateway (only tried when earlier ones failed). */
  attempts: number;
  /** 2xx responses. */
  hits: number;
  /** Reachable but non-2xx (e.g. 404 — the gateway simply lacked that CID). */
  misses: number;
  /** Requests aborted at {@link UPSTREAM_TIMEOUT_MS}. */
  timeouts: number;
  /** Connection/transport failures. */
  unreachable: number;
  /**
   * `false` ONLY when attempts were made yet the gateway was never once reached
   * (`attempts > 0 && hits === 0 && misses === 0` — every attempt timed out or was unreachable).
   * A 404 counts as reached, so a miss keeps a gateway healthy.
   */
  healthy: boolean;
  /** Short human hint for the CLI render; omitted for a plainly-serving gateway. */
  note?: string;
}
