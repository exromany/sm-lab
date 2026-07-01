import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveIpfsApiUrl,
  hasPinataCredentials,
  hasCustomIpfsEndpoint,
  shouldAttemptPin,
  pinJsonToIpfs,
  DEFAULT_IPFS_API_URL,
  LOCAL_IPFS_API_URL,
} from '../src/ipfs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('resolveIpfsApiUrl', () => {
  it('prefers an explicit argument', () => {
    expect(resolveIpfsApiUrl('http://localhost:9999')).toBe('http://localhost:9999');
  });

  it('falls back to IPFS_API_URL env', () => {
    vi.stubEnv('IPFS_API_URL', 'http://127.0.0.1:3000/');
    // trailing slash is stripped so endpoint joins are clean
    expect(resolveIpfsApiUrl()).toBe('http://127.0.0.1:3000');
  });

  it('uses Pinata when PINATA_JWT is set and IPFS_API_URL is unset', () => {
    vi.stubEnv('IPFS_API_URL', '');
    vi.stubEnv('PINATA_JWT', 'tok');
    expect(resolveIpfsApiUrl()).toBe(DEFAULT_IPFS_API_URL);
  });

  it('uses Pinata when PINATA_API_KEY+SECRET are set and IPFS_API_URL is unset', () => {
    vi.stubEnv('IPFS_API_URL', '');
    vi.stubEnv('PINATA_API_KEY', 'k');
    vi.stubEnv('PINATA_API_SECRET', 's');
    expect(resolveIpfsApiUrl()).toBe(DEFAULT_IPFS_API_URL);
  });

  it('falls back to LOCAL_IPFS_API_URL when nothing is set', () => {
    vi.stubEnv('IPFS_API_URL', '');
    vi.stubEnv('PINATA_JWT', '');
    vi.stubEnv('PINATA_API_KEY', '');
    vi.stubEnv('PINATA_API_SECRET', '');
    expect(resolveIpfsApiUrl()).toBe(LOCAL_IPFS_API_URL);
  });
});

describe('hasPinataCredentials', () => {
  it('true with key + secret', () => {
    expect(hasPinataCredentials({ apiKey: 'k', apiSecret: 's' })).toBe(true);
  });

  it('true with a JWT', () => {
    expect(hasPinataCredentials({ jwt: 'token' })).toBe(true);
  });

  it('false with neither', () => {
    expect(hasPinataCredentials({})).toBe(false);
    expect(hasPinataCredentials({ apiKey: 'k' })).toBe(false);
  });
});

describe('hasCustomIpfsEndpoint', () => {
  it('true for a non-default endpoint (the local mock)', () => {
    expect(hasCustomIpfsEndpoint({ apiUrl: 'http://127.0.0.1:3000' })).toBe(true);
    expect(hasCustomIpfsEndpoint({ apiUrl: 'http://127.0.0.1:3000/' })).toBe(true);
  });

  it('false when unset or pointing at real Pinata', () => {
    expect(hasCustomIpfsEndpoint({})).toBe(false);
    expect(hasCustomIpfsEndpoint({ apiUrl: '' })).toBe(false);
    expect(hasCustomIpfsEndpoint({ apiUrl: DEFAULT_IPFS_API_URL })).toBe(false);
  });
});

describe('shouldAttemptPin', () => {
  it('pins to a custom endpoint without credentials (local mock)', () => {
    expect(shouldAttemptPin({ apiUrl: 'http://127.0.0.1:3000' })).toBe(true);
  });

  it('pins to real Pinata when credentials are present', () => {
    expect(shouldAttemptPin({ jwt: 'tok' })).toBe(true);
    expect(shouldAttemptPin({ apiKey: 'k', apiSecret: 's' })).toBe(true);
  });

  it('pins by default (no env set) — falls through to local @sm-lab/ipfs', () => {
    // With no opts at all, the local default is always usable.
    expect(shouldAttemptPin({})).toBe(true);
  });

  it('skips only when IPFS_API_URL explicitly points at real Pinata with no credentials', () => {
    expect(shouldAttemptPin({ apiUrl: DEFAULT_IPFS_API_URL })).toBe(false);
  });

  it('pins to LOCAL_IPFS_API_URL via env when IPFS_API_URL is the local address', () => {
    expect(shouldAttemptPin({ apiUrl: LOCAL_IPFS_API_URL })).toBe(true);
  });
});

describe('pinJsonToIpfs', () => {
  it('POSTs the Pinata envelope to the configured endpoint and returns the CID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ IpfsHash: 'bafyTest', PinSize: 12, Timestamp: 'now' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cid = await pinJsonToIpfs({ hello: 'world' }, 'merkle-tree-ics', {
      apiUrl: 'http://127.0.0.1:3000',
      apiKey: 'k',
      apiSecret: 's',
    });

    expect(cid).toBe('bafyTest');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/pinning/pinJSONToIPFS');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      pinataContent: { hello: 'world' },
      pinataMetadata: { name: 'merkle-tree-ics' },
    });
    expect(init.headers.pinata_api_key).toBe('k');
    expect(init.headers.pinata_secret_api_key).toBe('s');
  });

  it('sends a Bearer header when given a JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ IpfsHash: 'cid', PinSize: 1, Timestamp: 'now' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await pinJsonToIpfs({}, 'x', { apiUrl: 'http://h', jwt: 'tok' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 401, statusText: 'Unauthorized' })),
    );
    await expect(pinJsonToIpfs({}, 'x', { apiUrl: 'http://h' })).rejects.toThrow(/401/);
  });

  it('throws when the response lacks an IpfsHash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(pinJsonToIpfs({}, 'x', { apiUrl: 'http://h' })).rejects.toThrow(/IpfsHash/);
  });
});
