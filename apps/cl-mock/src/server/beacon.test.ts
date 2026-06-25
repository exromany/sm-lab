import { describe, expect, it } from 'vitest';
import { buildValidator } from './beacon';

// Characterization tests: pin the Beacon API response shape. The CLAUDE.md warns this
// format is consumed by the SDK — these lock it so the tsdown migration can't drift it.
describe('buildValidator', () => {
  it('builds an active_ongoing validator with defaults', () => {
    const v = buildValidator('0xabc', { status: 'active_ongoing' }, 900000);
    expect(v).toMatchObject({
      index: '900000',
      balance: '32000000000',
      status: 'active_ongoing',
      validator: {
        pubkey: '0xabc',
        effective_balance: '32000000000',
        slashed: false,
        activation_eligibility_epoch: '0',
        activation_epoch: '0',
        exit_epoch: '18446744073709551615',
        withdrawable_epoch: '18446744073709551615',
      },
    });
  });

  it('collapses withdrawal_done_slashed → withdrawal_done and infers slashed:true', () => {
    const v = buildValidator('0xdef', { status: 'withdrawal_done_slashed' }, 900001);
    expect(v.status).toBe('withdrawal_done');
    expect(v.validator.slashed).toBe(true);
  });

  it('honors explicit index and effective_balance, mirroring balance', () => {
    const v = buildValidator(
      '0x1',
      { status: 'active_ongoing', index: 5, effective_balance: '31000000000' },
      900000,
    );
    expect(v.index).toBe('5');
    expect(v.validator.effective_balance).toBe('31000000000');
    expect(v.balance).toBe('31000000000');
  });
});
