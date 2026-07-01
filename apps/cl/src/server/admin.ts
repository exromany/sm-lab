import type { Hono } from 'hono';
import { store } from './store';
import {
  isValidPubkey,
  isValidStatus,
  VALIDATOR_STATUSES,
  type ValidatorEntry,
  type ValidatorStatus,
} from '../types';

function logChange(line: string): void {
  console.log(`[${new Date().toISOString()}] ${line}`);
}

/**
 * cl-mock-specific admin routes — the `/admin/validators` CRUD surface.
 * The shared `/admin/status` + `/admin/shutdown` come from `@sm-lab/core`'s
 * `registerAdminRoutes` (wired in `app.ts`).
 */
export function registerValidatorRoutes(app: Hono): void {
  app.get('/admin/validators', (c) => {
    const validators = store.list().map(({ pubkey, entry }) => ({
      pubkey,
      status: entry.status,
      ...(entry.effective_balance !== undefined
        ? { effective_balance: entry.effective_balance }
        : {}),
    }));
    return c.json(validators);
  });

  app.post('/admin/validators', async (c) => {
    const body = await c.req.json();
    const items = Array.isArray(body) ? body : [body];

    const errors: string[] = [];
    const accepted: Array<{
      pubkey: string;
      status: ValidatorStatus;
      effective_balance?: string;
    }> = [];

    for (const item of items) {
      const { pubkey, status, effective_balance } = item;
      if (!pubkey || !isValidPubkey(pubkey)) {
        errors.push(`invalid pubkey '${pubkey}': expected 0x-prefixed 96-hex-char string`);
        continue;
      }
      if (!status || !isValidStatus(status)) {
        errors.push(`invalid status '${status}': must be one of ${VALIDATOR_STATUSES.join(', ')}`);
        continue;
      }
      if (
        effective_balance !== undefined &&
        (typeof effective_balance !== 'string' || !/^\d+$/.test(effective_balance))
      ) {
        errors.push(
          `invalid effective_balance '${effective_balance}': expected a gwei integer string`,
        );
        continue;
      }
      accepted.push({ pubkey, status, effective_balance });
    }

    if (errors.length > 0 && accepted.length === 0) {
      return c.json({ errors }, 400);
    }

    for (const { pubkey, status, effective_balance } of accepted) {
      const entry: ValidatorEntry = { status };
      if (effective_balance !== undefined) {
        entry.effective_balance = effective_balance;
      }
      const { prior } = store.set(pubkey, entry);
      const key = pubkey.toLowerCase();
      const ebSuffix = effective_balance !== undefined ? ` eb=${effective_balance}` : '';
      if (!prior) {
        logChange(`+ ${key} ${status}${ebSuffix}`);
      } else if (prior.status !== status || prior.effective_balance !== effective_balance) {
        const priorEb = prior.effective_balance ?? '-';
        const nextEb = effective_balance ?? '-';
        logChange(`~ ${key} ${prior.status} → ${status} eb=${priorEb} → ${nextEb}`);
      }
    }

    return c.json({ accepted: accepted.length, errors }, errors.length ? 207 : 200);
  });

  app.delete('/admin/validators', (c) => {
    const count = store.clear();
    if (count > 0) logChange(`cleared ${count} validators`);
    return c.body(null, 204);
  });

  app.delete('/admin/validators/:pubkey', (c) => {
    const pubkey = c.req.param('pubkey');
    if (store.delete(pubkey)) logChange(`- ${pubkey.toLowerCase()}`);
    return c.body(null, 204);
  });
}
