import type { ValidatorEntry } from '../types';

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
}

export const store = new ValidatorStore();
