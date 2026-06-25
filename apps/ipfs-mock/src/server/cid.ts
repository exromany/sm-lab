import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

/**
 * Deterministic content address for a byte buffer.
 *
 * CIDv1 / raw codec (0x55) / sha2-256. Same bytes → same CID, every run, no network.
 * This is a REAL, valid CID — but note it will NOT byte-match `ipfs add`'s default,
 * which wraps content in a UnixFS dag-pb node before hashing. Matching that would need
 * `ipfs-unixfs-importer` (a new dep, out of scope). For round-tripping content through
 * THIS mock and pinning stable fixtures, deterministic addressing is what matters.
 */
export async function computeCid(bytes: Uint8Array): Promise<string> {
  const hash = await sha256.digest(bytes);
  return CID.create(1, raw.code, hash).toString();
}

/** Canonical JSON bytes — `JSON.stringify` with no whitespace, so identical objects hash alike. */
export function jsonToBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** True if `value` is a syntactically plausible CID (so we can reject garbage before proxying). */
export function isLikelyCid(value: string): boolean {
  try {
    CID.parse(value);
    return true;
  } catch {
    return false;
  }
}
