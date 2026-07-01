---
'@sm-lab/merkle': minor
---

Migrate `csm-test-tree` into the sm-lab monorepo as `@sm-lab/merkle` (bin `sm-merkle`).
Build moves from `ts-node`/CommonJS to tsdown (ESM, bundled), split into a library export (`.`)
and the `sm-merkle` bin.

Scope is focused on **build + pin**: `ics <addresses>` and `strikes <strikes>` each build a
`StandardMerkleTree`, pin it to IPFS, and print the root + CID (`--no-upload` for root-only,
`-o` to also write a `{ treeRoot, treeCid }` handoff file). Pushing root/CID on-chain and
resolving deploy addresses are intentionally **out of scope** — that work belongs to
`@sm-lab/receipts` (no `cast`, no `DEPLOY_JSON_PATH`).

The IPFS endpoint is env-switchable via `IPFS_API_URL` (a thin Pinata-compatible `fetch`
client, since `@pinata/sdk` v2 hardcodes its host) so it targets `@sm-lab/ipfs` locally
or real Pinata; a custom endpoint pins without credentials. Adds the first Vitest suite pinning
the deterministic tree roots, leaf encodings, proofs, parsers, and the IPFS client request shape.
