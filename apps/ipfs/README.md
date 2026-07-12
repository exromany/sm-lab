# @sm-lab/ipfs

Pinata-compatible IPFS pinning service **and** gateway, with deterministic CIDs — a
drop-in stand-in for Pinata in Lido SM testing. Same Hono + commander shape as `cl-mock`.

## Quick start

```sh
npx @sm-lab/ipfs serve     # binary is sm-ipfs; listens on 127.0.0.1:5001
sm-ipfs status             # health + pin count + per-gateway upstream health
sm-ipfs stop               # graceful shutdown
sm-ipfs help               # full agent-facing guide
```

Point `@pinata/sdk` (or any fetch client) at `http://127.0.0.1:5001` — no code change.

## API surface

### Pinata-compatible pinning API

| Method | Route                    | Notes                                                                                                |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST   | `/pinning/pinJSONToIPFS` | JSON body (bare, or `{ pinataContent, pinataMetadata }`); returns `{ IpfsHash, PinSize, Timestamp }` |
| POST   | `/pinning/pinFileToIPFS` | `multipart/form-data`, field `file`; same response shape                                             |
| GET    | `/data/pinList`          | `{ count, rows: [{ ipfs_pin_hash, size, date_pinned, ... }] }`                                       |
| DELETE | `/pinning/unpin/:cid`    | remove a pin (`404` if absent)                                                                       |

### IPFS gateway (read-back)

| Method | Route        | Behavior                                                                       |
| ------ | ------------ | ------------------------------------------------------------------------------ |
| GET    | `/ipfs/:cid` | store **HIT** → serve stored bytes; store **MISS** → proxy to upstream gateway |

A store-miss on a valid CID is proxied to a real upstream IPFS gateway via global `fetch`
(with an `AbortController` timeout — never hangs). Successfully-proxied content is cached
back into the store, so a second read is a local hit. Failures surface cleanly: invalid
CID → `400`, upstream unreachable → `502`, upstream timeout → `504`.

### Admin (parity with cl-mock)

| Method | Route             |                                                                                              |
| ------ | ----------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/admin/status`   | `{ ok, version, startedAt, uptimeSeconds, gateway, gateways?, pins: { total, totalBytes } }` |
| POST   | `/admin/shutdown` | graceful shutdown                                                                            |

`gateways` is a per-gateway health array (chain order) — each entry is
`{ gateway, attempts, hits, misses, timeouts, unreachable, healthy, note? }`, tallying
proxied traffic since boot. A gateway is `healthy: false` only when it was tried yet never
once reached (all timeouts/unreachable); a 404 counts as reached. Counts are in-memory and
reset on restart. `sm-ipfs status` renders this as a ✓/✗/— table.

## Upstream gateway (for store-miss CIDs)

- **Bundled default chain:** `https://dweb.link` → `https://ipfs.io`, tried in order — the
  first `2xx` wins; a miss/timeout/unreachable falls through to the next. `dweb.link` is the
  Protocol Labs subdomain gateway many IPFS clients resolve against; `ipfs.io` backs it up.
- **Override**, highest priority last: bundled defaults → `IPFS_UPSTREAM_GATEWAY` env →
  `serve --gateway <url>`. A comma-separated value sets a multi-gateway chain; a single
  value replaces the chain entirely.

```sh
IPFS_UPSTREAM_GATEWAY=https://ipfs.io,https://dweb.link sm-ipfs serve
sm-ipfs serve --gateway https://ipfs.io
```

Use `sm-ipfs status` to see which gateways in the chain are actually serving — a persistently
failing one shows `✗` (see [Admin](#admin-parity-with-cl-mock)).

## Deterministic CIDs — and the UnixFS-parity caveat

CIDs are computed from the content bytes with `multiformats`: **CIDv1 / raw codec
(`0x55`) / sha2-256**. Same content → same CID, every run, no network. These are **real,
valid CIDs**, so fixtures can hard-code expected values and round-trips through this mock
are reproducible.

> **Caveat:** these CIDs will **not** byte-match `ipfs add`'s default CID. `ipfs add`
> wraps content in a UnixFS dag-pb node before hashing; we hash the raw bytes directly.
> Exact production parity would require `ipfs-unixfs-importer` (a new dependency, out of
> scope). For our use — pin a tree JSON and read it back from the **same** mock, with
> stable fixtures — round-trip determinism is what matters, not UnixFS parity.

## State & persistence

In-memory by default (restart = clean slate). Two independent ways to keep pins:

- `--persist <dir>` — per-pin directory mirror, written as pins change
  (`<dir>/<cid>.bin` + `<cid>.json`), replayed on the next start.
- `--state <file>` — single JSON snapshot of the whole store: loaded on boot, saved on
  graceful shutdown. Also enables `POST /admin/save` + `POST /admin/load`, bound to the
  configured path only (never a client-supplied one). Env fallback: `IPFS_MOCK_STATE`.

```sh
sm-ipfs serve --persist ./pins
sm-ipfs serve --state ./ipfs-state.json
```

## Library usage

The package also exports its internals so consumers can embed the mock in-process and
inject a stub upstream fetcher (hermetic tests — no network):

```ts
import { createApp } from '@sm-lab/ipfs';

const { app } = createApp({
  fetchUpstream: async (cid) => ({ ok: true, status: 200, contentType: 'text/plain', data }),
});
const res = await app.request('/pinning/pinJSONToIPFS', { method: 'POST', body });
```

Exports: `app`, `createApp`, `startServer`, `PinStore` / `store`, `computeCid`,
`createUpstreamFetcher`, and the route registrars.
