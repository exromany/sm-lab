import type { Hono } from 'hono';
import { store } from './store';
import {
  EPOCH_DEFAULTS,
  API_STATUS,
  WC_PLACEHOLDER,
  AUTO_INDEX_START,
  type ValidatorEntry,
} from '../types';

export function buildValidator(pubkey: string, entry: ValidatorEntry, autoIndex: number) {
  const status = entry.status;
  const epochs = EPOCH_DEFAULTS[status] ?? EPOCH_DEFAULTS.active_ongoing;

  return {
    index: String(entry.index ?? autoIndex),
    balance: entry.balance ?? entry.effective_balance ?? '32000000000',
    status: API_STATUS[status] ?? status,
    validator: {
      pubkey,
      withdrawal_credentials: entry.withdrawal_credentials ?? WC_PLACEHOLDER,
      effective_balance: entry.effective_balance ?? '32000000000',
      slashed: entry.slashed ?? status.endsWith('_slashed'),
      activation_eligibility_epoch: '0',
      activation_epoch: epochs.activation_epoch,
      exit_epoch: epochs.exit_epoch,
      withdrawable_epoch: epochs.withdrawable_epoch,
    },
  };
}

export function registerBeaconRoutes(app: Hono): void {
  app.get('/eth/v1/beacon/states/:state_id/validators', (c) => {
    const ids = c.req.query('id')?.split(',').filter(Boolean) ?? [];

    const data: ReturnType<typeof buildValidator>[] = [];
    let autoIndex = AUTO_INDEX_START;

    for (const id of ids) {
      const key = id.toLowerCase();
      const entry = store.get(key);
      if (!entry?.status) continue;
      data.push(buildValidator(key, entry, autoIndex++));
    }

    return c.json({
      execution_optimistic: false,
      finalized: true,
      data,
    });
  });
}
