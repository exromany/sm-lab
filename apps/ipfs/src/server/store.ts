import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pin } from '../types';

/**
 * In-memory pin store keyed by CID, with an optional file-backed mirror (`--persist <dir>`).
 *
 * In-memory is always the source of truth. When a persist dir is configured, every mutation
 * is mirrored to `<dir>/<cid>.bin` (raw bytes) + `<dir>/<cid>.json` (metadata), and the dir is
 * replayed into memory on construction — so a restart survives. Kept deliberately simple: no
 * locking, no compaction. Built-ins only (node:fs), no new deps.
 */
export class PinStore {
  private pins = new Map<string, Pin>();
  private readonly dir?: string;

  constructor(persistDir?: string) {
    this.dir = persistDir;
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
      this.load();
    }
  }

  set(pin: Pin): { isNew: boolean } {
    const isNew = !this.pins.has(pin.cid);
    this.pins.set(pin.cid, pin);
    if (this.dir) this.persist(pin);
    return { isNew };
  }

  get(cid: string): Pin | undefined {
    return this.pins.get(cid);
  }

  has(cid: string): boolean {
    return this.pins.has(cid);
  }

  delete(cid: string): boolean {
    const existed = this.pins.delete(cid);
    if (existed && this.dir) {
      rmSync(join(this.dir, `${cid}.bin`), { force: true });
      rmSync(join(this.dir, `${cid}.json`), { force: true });
    }
    return existed;
  }

  list(): Pin[] {
    return Array.from(this.pins.values());
  }

  clear(): number {
    const count = this.pins.size;
    // Snapshot keys before deleting — mutating a Map mid-iteration is unsafe.
    for (const cid of Array.from(this.pins.keys())) this.delete(cid);
    return count;
  }

  get size(): number {
    return this.pins.size;
  }

  private persist(pin: Pin): void {
    if (!this.dir) return;
    writeFileSync(join(this.dir, `${pin.cid}.bin`), pin.data);
    const meta = {
      cid: pin.cid,
      size: pin.size,
      contentType: pin.contentType,
      pinnedAt: pin.pinnedAt,
      ...(pin.name !== undefined ? { name: pin.name } : {}),
    };
    writeFileSync(join(this.dir, `${pin.cid}.json`), JSON.stringify(meta));
  }

  private load(): void {
    if (!this.dir || !existsSync(this.dir)) return;
    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      const cid = file.slice(0, -'.json'.length);
      const binPath = join(this.dir, `${cid}.bin`);
      if (!existsSync(binPath)) continue;
      const meta = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as Omit<Pin, 'data'>;
      this.pins.set(cid, { ...meta, data: new Uint8Array(readFileSync(binPath)) });
    }
  }
}

/** Default singleton store (in-memory). Swap via the app factory for tests/persistence. */
export const store = new PinStore();

// ---------------------------------------------------------------------------
// State serialization (for core's registerStateRoutes + server-boot wiring)
// ---------------------------------------------------------------------------

/** JSON-safe shape for a serialized pin (Uint8Array → base64). */
interface SerializedPin {
  cid: string;
  size: number;
  data: string; // base64
  contentType: string;
  pinnedAt: string;
  name?: string;
}

/** Serialize the entire store to a plain JSON-safe object. */
export function snapshotStore(s: PinStore): unknown {
  return s.list().map((p): SerializedPin => ({
    cid: p.cid,
    size: p.size,
    data: Buffer.from(p.data).toString('base64'),
    contentType: p.contentType,
    pinnedAt: p.pinnedAt,
    ...(p.name !== undefined ? { name: p.name } : {}),
  }));
}

/** Restore the store from a previously-snapshotted value (replaces all pins). */
export function restoreStore(s: PinStore, raw: unknown): void {
  s.clear();
  if (!Array.isArray(raw)) return;
  for (const item of raw as SerializedPin[]) {
    // Guard required fields before use — a malformed item (e.g. data: null from a
    // hand-edited or truncated file) must skip silently, mirroring ValidatorStore.restore().
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof item.cid !== 'string' ||
      typeof item.data !== 'string' ||
      typeof item.contentType !== 'string' ||
      typeof item.pinnedAt !== 'string'
    ) {
      continue;
    }
    s.set({
      cid: item.cid,
      size: item.size,
      data: new Uint8Array(Buffer.from(item.data, 'base64')),
      contentType: item.contentType,
      pinnedAt: item.pinnedAt,
      ...(item.name !== undefined ? { name: item.name } : {}),
    });
  }
}
