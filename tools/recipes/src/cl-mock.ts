/**
 * cl-mock bridge — a thin `fetch` client that POSTs one validator to a running
 * `@csm-lab/cl-mock` (`/admin/validators`). Mirrors the discipline of `tools/merkle/src/ipfs.ts`:
 * trailing-slash-stripped URL join, explicit `as` cast for the response (no DOM lib), and a
 * throw carrying status + the mock's `errors[]`. Ctx-agnostic — takes a `clMockUrl: string`, not
 * the whole `Ctx`, so it stays trivially unit-testable.
 */

import type { Hex } from '@csm-lab/receipts';

export interface SetValidatorInput {
  pubkey: Hex;
  /** Only status clActivate sets; cl-mock's full union lives in the app, not here. */
  status: 'active_ongoing';
  /** Serialized to a gwei integer string on the wire; omitted when undefined. */
  effectiveBalanceGwei?: bigint;
}

interface ClMockResponse {
  accepted: number;
  errors: string[];
}

/**
 * POST one validator to a running `@csm-lab/cl-mock` `/admin/validators`. Surfaces the mock's
 * `errors[]` and throws unless the single item was accepted.
 *
 * cl-mock returns 200 (clean), 207 (partial — only when `errors.length > 0` AND `accepted > 0`,
 * which is impossible for a single item), or 400 (all rejected, no `accepted` field). For one
 * item the realistic failure is 400, caught by the `!res.ok` clause — note `undefined < 1` is
 * `false`, so the `accepted` check alone would NOT catch a 400. The `accepted < 1` guard is a
 * defensive belt-and-braces for a synthetic 207/accepted:0 body the mock never actually emits.
 */
export async function setClValidator(clMockUrl: string, input: SetValidatorInput): Promise<void> {
  const url = `${clMockUrl.replace(/\/+$/, '')}/admin/validators`;
  const body = JSON.stringify({
    pubkey: input.pubkey,
    status: input.status,
    ...(input.effectiveBalanceGwei !== undefined
      ? { effective_balance: input.effectiveBalanceGwei.toString() }
      : {}),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const json = (await res.json().catch(() => undefined)) as ClMockResponse | undefined;
  if (!res.ok || !json || json.accepted < 1) {
    const errs = json?.errors?.length ? ` — ${json.errors.join('; ')}` : '';
    throw new Error(
      `@csm-lab/recipes: cl-mock rejected validator (${res.status} ${res.statusText})${errs}`,
    );
  }
}
