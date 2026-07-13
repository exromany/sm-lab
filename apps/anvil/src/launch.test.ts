import { describe, expect, test } from 'vitest';
import { buildAnvilArgs, findStatePath, resolveForkBlock, resolveRpc } from './launch';

describe('resolveRpc', () => {
  test('prefers MAINNET_RPC_URL over the fallbacks', () => {
    const rpc = resolveRpc({
      MAINNET_RPC_URL: 'https://mainnet',
      ANVIL_FORK_URL: 'https://fork',
      ETH_RPC_URL: 'https://eth',
    });
    expect(rpc).toBe('https://mainnet');
  });

  test('falls back to ANVIL_FORK_URL, then ETH_RPC_URL', () => {
    expect(resolveRpc({ ANVIL_FORK_URL: 'https://fork', ETH_RPC_URL: 'https://eth' })).toBe(
      'https://fork',
    );
    expect(resolveRpc({ ETH_RPC_URL: 'https://eth' })).toBe('https://eth');
  });

  test('is undefined when no RPC var is set', () => {
    expect(resolveRpc({})).toBeUndefined();
  });

  test('ignores empty-string values', () => {
    expect(resolveRpc({ MAINNET_RPC_URL: '', ETH_RPC_URL: 'https://eth' })).toBe('https://eth');
  });
});

describe('resolveForkBlock', () => {
  test('defaults to the baked snapshot block 25523407', () => {
    expect(resolveForkBlock({})).toBe('25523407');
  });

  test('honors ANVIL_FORK_BLOCK override', () => {
    expect(resolveForkBlock({ ANVIL_FORK_BLOCK: '26000000' })).toBe('26000000');
  });
});

describe('findStatePath', () => {
  test('honors ANVIL_STATE_FILE override verbatim', () => {
    expect(findStatePath({ ANVIL_STATE_FILE: '/tmp/custom.json' })).toBe('/tmp/custom.json');
  });

  test('otherwise resolves the baked state inside the package', () => {
    const p = findStatePath({});
    expect(p).toMatch(/[/\\]state[/\\]mainnet-upgraded\.state\.json$/);
  });
});

describe('buildAnvilArgs', () => {
  test('assembles fork-url, fork-block-number and load-state in order', () => {
    expect(
      buildAnvilArgs({
        rpc: 'https://mainnet',
        forkBlock: '25523407',
        statePath: '/pkg/state/s.json',
        passthrough: [],
      }),
    ).toEqual([
      '--fork-url',
      'https://mainnet',
      '--fork-block-number',
      '25523407',
      '--load-state',
      '/pkg/state/s.json',
    ]);
  });

  test('appends passthrough flags after the managed ones, preserving order', () => {
    const args = buildAnvilArgs({
      rpc: 'https://mainnet',
      forkBlock: '25523407',
      statePath: '/pkg/state/s.json',
      passthrough: ['--host', '0.0.0.0', '--port', '8546'],
    });
    expect(args.slice(-4)).toEqual(['--host', '0.0.0.0', '--port', '8546']);
  });
});
