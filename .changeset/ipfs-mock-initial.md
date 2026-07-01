---
'@sm-lab/ipfs': minor
---

Add `@sm-lab/ipfs` (`sm-ipfs` bin): a Pinata-compatible IPFS pinning + gateway
emulator for CSM testing. Implements `POST /pinning/pinJSONToIPFS`, `POST /pinning/pinFileToIPFS`,
`GET /data/pinList`, and `DELETE /pinning/unpin/:cid` with deterministic CIDs (CIDv1 / raw codec
0x55 / sha2-256). The `GET /ipfs/:cid` gateway serves locally-pinned content and transparently
proxies store-miss CIDs to a real upstream gateway (default `https://dweb.link`, overridable via
`IPFS_UPSTREAM_GATEWAY` or `serve --gateway`), caching proxied results. Same Hono + commander shape
as `cl-mock` (`serve`/`status`/`stop`/`help`, in-memory store with optional `--persist <dir>`,
graceful shutdown). The app factory is injectable (`createApp({ store, fetchUpstream })`) so tests
run hermetically with no network.
