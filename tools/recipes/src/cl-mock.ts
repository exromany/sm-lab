/**
 * cl-mock bridge — a thin `fetch` client that POSTs one validator to a running
 * `@sm-lab/cl` (`/admin/validators`). Mirrors the discipline of `tools/merkle/src/ipfs.ts`:
 * trailing-slash-stripped URL join, explicit `as` cast for the response (no DOM lib), and a
 * throw carrying status + the mock's `errors[]`. Ctx-agnostic — takes a `clMockUrl: string`, not
 * the whole `Ctx`, so it stays trivially unit-testable.
 */

import type { Hex } from '@sm-lab/receipts';

export interface SetValidatorInput {
  pubkey: Hex;
  /**
   * The CL statuses the recipes bridge sets: `active_ongoing` (clActivate) / `active_exiting`
   * (exitRequest's optional flip). cl-mock's full status union lives in the app, not here.
   */
  status: 'active_ongoing' | 'active_exiting';
  /** Serialized to a gwei integer string on the wire; omitted when undefined. */
  effectiveBalanceGwei?: bigint;
}

interface ClMockResponse {
  accepted: number;
  errors: string[];
}

/**
 * POST one validator to a running `@sm-lab/cl` `/admin/validators`. Surfaces the mock's
 * `errors[]` and throws unless the single item was accepted.
 *
 * cl-mock returns 200 (clean), 207 (partial — only when `errors.length > 0` AND `accepted > 0`,
 * which is impossible for a single item), or 400 (all rejected, no `accepted` field). For one
 * item the realistic failure is 400, caught by the `!res.ok` clause. The `(accepted ?? 0) < 1`
 * guard is defensive belt-and-braces for a synthetic accepted:0 / missing-`accepted` body the mock
 * never actually emits — the `?? 0` is load-bearing, since a bare `accepted < 1` is `false` for
 * `undefined` and would let such a body through as a silent success.
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

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    // fetch() *throws* (not resolves) on a connection failure — the cl-mock isn't running/reachable.
    // Distinct from an HTTP rejection (400 etc.), which resolves and is handled by `!res.ok` below.
    throw new Error(
      `@sm-lab/recipes: cannot reach the cl-mock at ${clMockUrl}. ` +
        `Start it (npx @sm-lab/cl serve) and pass --cl-mock-url <url> (or set CL_MOCK_URL).`,
    );
  }

  const json = (await res.json().catch(() => undefined)) as ClMockResponse | undefined;
  if (!res.ok || !json || (json.accepted ?? 0) < 1) {
    const errs = json?.errors?.length ? ` — ${json.errors.join('; ')}` : '';
    throw new Error(
      `@sm-lab/recipes: cl-mock rejected validator (${res.status} ${res.statusText})${errs}`,
    );
  }
}
