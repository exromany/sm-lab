export const VALIDATOR_STATUSES = [
  'pending_initialized',
  'pending_queued',
  'active_ongoing',
  'active_exiting',
  'active_slashed',
  'exited_unslashed',
  'exited_slashed',
  'withdrawal_possible',
  'withdrawal_done',
  'withdrawal_possible_slashed',
  'withdrawal_done_slashed',
] as const;

export type ValidatorStatus = (typeof VALIDATOR_STATUSES)[number];

export interface ValidatorEntry {
  status: ValidatorStatus;
  index?: number;
  balance?: string;
  effective_balance?: string;
  withdrawal_credentials?: string;
  slashed?: boolean;
}

export const FAR_FUTURE = '18446744073709551615';
export const WC_PLACEHOLDER = '0x02000000000000000000000x4473dcddbf77679a643bdb654dbd86d67f8d32f2';
export const DEFAULT_PORT = 5052;
export const DEFAULT_HOST = '127.0.0.1';
export const AUTO_INDEX_START = 900000;

export const EPOCH_DEFAULTS: Record<
  ValidatorStatus,
  { activation_epoch: string; exit_epoch: string; withdrawable_epoch: string }
> = {
  pending_initialized: {
    activation_epoch: FAR_FUTURE,
    exit_epoch: FAR_FUTURE,
    withdrawable_epoch: FAR_FUTURE,
  },
  pending_queued: {
    activation_epoch: FAR_FUTURE,
    exit_epoch: FAR_FUTURE,
    withdrawable_epoch: FAR_FUTURE,
  },
  active_ongoing: {
    activation_epoch: '0',
    exit_epoch: FAR_FUTURE,
    withdrawable_epoch: FAR_FUTURE,
  },
  active_exiting: {
    activation_epoch: '0',
    exit_epoch: '999999',
    withdrawable_epoch: '1000255',
  },
  active_slashed: {
    activation_epoch: '0',
    exit_epoch: '999999',
    withdrawable_epoch: '1000255',
  },
  exited_unslashed: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
  exited_slashed: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
  withdrawal_possible: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
  withdrawal_done: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
  withdrawal_possible_slashed: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
  withdrawal_done_slashed: {
    activation_epoch: '0',
    exit_epoch: '100',
    withdrawable_epoch: '356',
  },
};

/** Maps internal statuses to Beacon API status names */
export const API_STATUS: Partial<Record<ValidatorStatus, string>> = {
  withdrawal_possible_slashed: 'withdrawal_possible',
  withdrawal_done_slashed: 'withdrawal_done',
};

export const PUBKEY_RE = /^0x[0-9a-fA-F]{96}$/;

export function isValidStatus(s: string): s is ValidatorStatus {
  return VALIDATOR_STATUSES.includes(s as ValidatorStatus);
}

export function isValidPubkey(s: string): boolean {
  return PUBKEY_RE.test(s);
}
