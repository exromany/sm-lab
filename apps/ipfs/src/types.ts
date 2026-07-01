export const DEFAULT_PORT = 5001;
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Public IPFS gateway used to resolve CIDs that were never pinned here. Chosen because
 * dweb.link is the Protocol Labs subdomain gateway — same content as ipfs.io, but it
 * serves from `<cid>.ipfs.dweb.link` paths AND honors plain `/ipfs/:cid`, and it is the
 * gateway js-ipfs/helia default to. Override via `IPFS_UPSTREAM_GATEWAY` or `serve --gateway`.
 */
export const DEFAULT_GATEWAY = 'https://dweb.link';

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
