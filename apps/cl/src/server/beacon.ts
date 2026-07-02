import type { Hono } from 'hono';
import { store } from './store';
import {
  EPOCH_DEFAULTS,
  API_STATUS,
  WC_PLACEHOLDER,
  AUTO_INDEX_START,
  type ValidatorEntry,
} from '../types';

// NOTE (known limitation): proxied/cached validators are re-emitted with the mock's
// synthetic status-driven epoch fields (activation_epoch/exit_epoch/withdrawable_epoch
// from EPOCH_DEFAULTS), NOT the upstream's real epoch values. Faithful epoch relay is
// deferred — store the epoch fields on ValidatorEntry and prefer them in buildValidator
// when that fidelity is required.
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

export interface BeaconRoutesOptions {
  /**
   * Optional upstream Beacon API base URL.
   * On a cache miss, the validators endpoint is proxied to
   * `<upstreamUrl>/eth/v1/beacon/states/<state_id>/validators?id=…`.
   * Upstream responses are stored in the in-memory store (so they are
   * included in save/load snapshots).  On error the route falls back to the
   * mock's own store silently.
   */
  upstreamUrl?: string;
  /**
   * Overridable fetch implementation (injected in tests; defaults to global fetch).
   */
  fetchFn?: typeof fetch;
}

export function registerBeaconRoutes(app: Hono, opts: BeaconRoutesOptions = {}): void {
  const { upstreamUrl, fetchFn = fetch } = opts;

  app.get('/eth/v1/beacon/states/:state_id/validators', async (c) => {
    const stateId = c.req.param('state_id');
    const ids = c.req.query('id')?.split(',').filter(Boolean) ?? [];

    const data: ReturnType<typeof buildValidator>[] = [];
    let autoIndex = AUTO_INDEX_START;

    // Separate known-in-store from cache-miss ids.
    const missingIds: string[] = [];
    for (const id of ids) {
      const key = id.toLowerCase();
      const entry = store.get(key);
      if (entry?.status) {
        data.push(buildValidator(key, entry, autoIndex++));
      } else {
        missingIds.push(id);
      }
    }

    // Proxy missing ids to upstream and cache the results.
    if (missingIds.length > 0 && upstreamUrl) {
      try {
        const idsParam = missingIds.map(encodeURIComponent).join(',');
        const url = `${upstreamUrl}/eth/v1/beacon/states/${encodeURIComponent(stateId)}/validators?id=${idsParam}`;
        const res = await fetchFn(url);
        if (res.ok) {
          const body = (await res.json()) as { data?: unknown[] };
          if (Array.isArray(body?.data)) {
            for (const item of body.data) {
              const v = item as {
                index?: string;
                balance?: string;
                status?: string;
                validator?: {
                  pubkey?: string;
                  withdrawal_credentials?: string;
                  effective_balance?: string;
                  slashed?: boolean;
                  activation_epoch?: string;
                  exit_epoch?: string;
                  withdrawable_epoch?: string;
                };
              };
              const pubkey = v.validator?.pubkey;
              const rawStatus = v.status;
              if (typeof pubkey !== 'string' || typeof rawStatus !== 'string') {
                continue;
              }
              const entry: ValidatorEntry = {
                status: rawStatus as ValidatorEntry['status'],
                ...(v.index !== undefined ? { index: Number(v.index) } : {}),
                ...(v.balance !== undefined ? { balance: v.balance } : {}),
                ...(v.validator?.effective_balance !== undefined
                  ? { effective_balance: v.validator.effective_balance }
                  : {}),
                ...(v.validator?.withdrawal_credentials !== undefined
                  ? { withdrawal_credentials: v.validator.withdrawal_credentials }
                  : {}),
                ...(v.validator?.slashed !== undefined ? { slashed: v.validator.slashed } : {}),
              };
              store.set(pubkey, entry);
              data.push(buildValidator(pubkey.toLowerCase(), entry, autoIndex++));
            }
          }
        }
        // If upstream call fails, fall through to the empty-data case below
        // (missingIds simply won't appear in the response — same as mock-only behavior).
      } catch {
        // Upstream unreachable or threw — fall back to mock-only gracefully.
      }
    }

    return c.json({
      execution_optimistic: false,
      finalized: true,
      data,
    });
  });
}
