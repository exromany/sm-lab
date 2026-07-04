import { describe, expect, it } from 'vitest';
import { sharedCommands } from '../src/cli/commands/shared';
import { flagProp } from '../src/cli/define';

describe('sharedCommands', () => {
  it('exposes the expected command names', () => {
    const names = sharedCommands.map((c) => c.name).toSorted();
    expect(names).toEqual(
      [
        'activate-keys',
        'add-bond',
        'add-keys',
        'bond-info',
        'cancel-penalty',
        'cl-activate',
        'compensate-penalty',
        'confirm-manager',
        'confirm-reward',
        'create-bond-debt',
        'deposit',
        'exit',
        'get-curve-info',
        'get-gate-tree',
        'get-key-balance',
        'get-last-operator',
        'get-pubkey',
        'increase-allocated-balance',
        'key-balances',
        'make-rewards',
        'operator-info',
        'operator-keys',
        'operators-count',
        'pause',
        'propose-manager',
        'propose-reward',
        'remove-key',
        'report-balance',
        'report-penalty',
        'resume',
        'revert',
        'set-target-limit',
        'settle-penalty',
        'slash',
        'snapshot',
        'submit-rewards',
        'top-up-active-keys',
        'topup',
        'unvet',
        'warp',
        'withdraw',
      ].toSorted(),
    );
  });
  it('every option has a coerce fn and a non-negation flag', () => {
    for (const c of sharedCommands)
      for (const o of c.options) {
        expect(typeof o.coerce).toBe('function');
        expect(o.flag.startsWith('--no-')).toBe(false);
        expect(flagProp(o.flag).length).toBeGreaterThan(0);
      }
  });
  it('cl-activate requires cl-mock', () => {
    expect(sharedCommands.find((c) => c.name === 'cl-activate')?.needsClMock).toBe(true);
  });
  it('a report renders a known result', () => {
    const addKeys = sharedCommands.find((c) => c.name === 'add-keys')!;
    expect(addKeys.report({ publicKeys: ['0xaa', '0xbb'] }, { noId: 0n, count: 2 })).toEqual([
      'operator 0: +2 keys',
      'pubkeys: 0xaa, 0xbb',
    ]);
  });
});
