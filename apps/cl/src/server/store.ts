import type { ValidatorEntry } from '../types';
import { isValidPubkey, isValidStatus } from '../types';

export interface StoreSnapshot {
  validators: Array<{ pubkey: string; entry: ValidatorEntry }>;
}

export class ValidatorStore {
  private validators = new Map<string, ValidatorEntry>();

  set(pubkey: string, entry: ValidatorEntry): { prior: ValidatorEntry | undefined } {
    const key = pubkey.toLowerCase();
    const prior = this.validators.get(key);
    this.validators.set(key, entry);
    return { prior };
  }

  get(pubkey: string): ValidatorEntry | undefined {
    return this.validators.get(pubkey.toLowerCase());
  }

  delete(pubkey: string): boolean {
    return this.validators.delete(pubkey.toLowerCase());
  }

  list(): Array<{ pubkey: string; entry: ValidatorEntry }> {
    return Array.from(this.validators.entries()).map(([pubkey, entry]) => ({
      pubkey,
      entry,
    }));
  }

  clear(): number {
    const count = this.validators.size;
    this.validators.clear();
    return count;
  }

  get size(): number {
    return this.validators.size;
  }

  /** Serialize the store as a plain JSON-serialisable value. */
  snapshot(): StoreSnapshot {
    return { validators: this.list() };
  }

  /**
   * Restore the store from a previously-taken snapshot.
   * Silently skips malformed entries (unknown status / invalid pubkey) so a
   * corrupt file never crashes the server.
   */
  restore(raw: unknown): void {
    this.validators.clear();
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !Array.isArray((raw as StoreSnapshot).validators)
    ) {
      return;
    }
    for (const item of (raw as StoreSnapshot).validators) {
      const { pubkey, entry } = item ?? {};
      if (
        typeof pubkey !== 'string' ||
        !isValidPubkey(pubkey) ||
        !entry ||
        !isValidStatus(entry.status)
      ) {
        continue;
      }
      this.validators.set(pubkey.toLowerCase(), entry);
    }
  }
}

export const store = new ValidatorStore();
