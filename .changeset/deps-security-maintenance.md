---
'@sm-lab/cl-mock': patch
'@sm-lab/ipfs-mock': patch
'@sm-lab/merkle': patch
'@sm-lab/recipes': patch
'@sm-lab/keys': patch
---

chore(deps): security + dependency maintenance.

- Patch transitive advisories via pnpm overrides: `ws` >=8.21.0 (GHSA-96hv-2xvq-fx4p, high) and `uuid` >=11.1.1 under `@metamask/utils` (GHSA-w5hq-g745-h8pq, moderate).
- Bump runtime deps: commander 15, dotenv 17, multiformats 14, @hono/node-server 2, @chainsafe/bls 8.
- Bump dev toolchain: TypeScript 6, Vitest 4, @types/node 26, prettier 3.9.
