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
