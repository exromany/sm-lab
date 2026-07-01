# @sm-lab/ipfs

Pinata-compatible IPFS pinning service **and** gateway, with deterministic CIDs — a
drop-in stand-in for Pinata in CSM testing. Same Hono + commander shape as `cl-mock`.

## Quick start

```sh
csm-ipfs-mock serve              # listens on 127.0.0.1:3000
csm-ipfs-mock status             # health + pin count + configured gateway
csm-ipfs-mock stop               # graceful shutdown
csm-ipfs-mock help               # full agent-facing guide
```

Point `@pinata/sdk` (or any fetch client) at `http://127.0.0.1:3000` — no code change.

## API surface

All routes are **CORS-enabled** (permissive `*`), so browser consumers (csm-widget) can
pin and read back cross-origin.

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

| Method | Route             |                                                                                   |
| ------ | ----------------- | --------------------------------------------------------------------------------- |
| GET    | `/admin/status`   | `{ ok, version, startedAt, uptimeSeconds, gateway, pins: { total, totalBytes } }` |
| POST   | `/admin/shutdown` | graceful shutdown                                                                 |

## Upstream gateway (for store-miss CIDs)

- **Bundled default:** `https://dweb.link` — the Protocol Labs subdomain gateway (same
  content as `ipfs.io`); it is the default many IPFS clients resolve against.
- **Override**, highest priority last: bundled default → `IPFS_UPSTREAM_GATEWAY` env →
  `serve --gateway <url>`.

```sh
IPFS_UPSTREAM_GATEWAY=https://ipfs.io csm-ipfs-mock serve
csm-ipfs-mock serve --gateway https://ipfs.io
```

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

In-memory by default (restart = clean slate). Pass `--persist <dir>` to mirror pins to
disk (`<dir>/<cid>.bin` + `<cid>.json`) and replay them on the next start.

```sh
csm-ipfs-mock serve --persist ./pins
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
