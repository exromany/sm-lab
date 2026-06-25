# @csm-lab/merkle

Merkle tree builder for Lido CSM. One job: **build a tree, pin it to IPFS, print the root +
CID.** Two tree shapes — **ICS** (vetted-gate addresses) and **strikes** (node-operator
violations).

```
input JSON → build StandardMerkleTree → pin to IPFS → print { treeRoot, treeCid }
```

> Pushing the root/CID on-chain (and resolving deploy addresses) is **not** this tool's job —
> that belongs to `@csm-lab/receipts`. merkle has no `cast`, no `DEPLOY_JSON_PATH`, no chain access.

## CLI

Binary: `csm-merkle` (`npx @csm-lab/merkle …`).

```bash
csm-merkle ics addresses.json              # build ICS tree, pin, print root + CID
csm-merkle strikes strikes.json            # build strikes tree, pin, print root + CID
csm-merkle ics addresses.json --no-upload  # build/print root only, skip pinning
csm-merkle ics addresses.json -o out.json  # also write { treeRoot, treeCid } to out.json
csm-merkle help                            # self-contained cheat sheet
```

Flags: `--no-upload` (root only, skip IPFS) · `-o, --out <path>` (also write a
`{ treeRoot, treeCid }` JSON — a handoff seam for `@csm-lab/receipts` / CI).

## Library

```ts
import { buildIcsTree, buildStrikesTree, pinJsonToIpfs, makeIcs } from '@csm-lab/merkle';

const tree = buildIcsTree(['0x70997970…', '0x3C44CdD…']);
tree.root; // deterministic 0x… root
const cid = await pinJsonToIpfs(tree.dump(), 'merkle-tree-ics'); // env-switched endpoint
```

Tree leaf encodings: ICS `["address"]` · strikes `["uint256", "string", "uint256[]"]`.

## Environment

| Var | Purpose |
| --- | --- |
| `IPFS_API_URL` | Pinning endpoint. **Unset → real Pinata** (`https://api.pinata.cloud`). Point at `@csm-lab/ipfs-mock` for local runs (e.g. `http://127.0.0.1:3000`) — a custom endpoint pins **without** Pinata credentials. |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | Pinata credentials (`pinata_api_key` / `pinata_secret_api_key` headers). |
| `PINATA_JWT` | Alternative to key/secret (`Authorization: Bearer …`). |

Copy `.env` from your own values; never commit secrets (`.env*` is gitignored).

### Why a custom IPFS client, not `@pinata/sdk`

`@pinata/sdk` v2 hardcodes `baseUrl = 'https://api.pinata.cloud'` with no host override, so it
can't target the local mock. `ipfs.ts` is a thin `fetch` client that POSTs the **same**
`/pinning/pinJSONToIPFS` envelope (`{ pinataContent, pinataMetadata }`), with the base URL
resolved from `IPFS_API_URL` (→ env → real-Pinata default). Real Pinata works unchanged.

## Build

tsdown (ESM, bundled) via the shared `@csm-lab/config` preset:

```ts
// tsdown.config.ts
import { libConfig } from '@csm-lab/config/tsdown';
export default libConfig({ entry: { index: 'src/index.ts', cli: 'src/cli.ts' }, format: ['esm'], platform: 'node' });
```

## Migration notes (from `csm-test-tree`)

- **ts-node / CommonJS → ESM + tsdown.** Explicit paths instead of `__dirname`-relative.
- **Scope trimmed to build + pin.** The original `set` phase (push root/CID on-chain via
  Foundry `cast`, read addresses from `DEPLOY_JSON_PATH`) was removed — that work moves to
  `@csm-lab/receipts`. The `make-ics`/`set-ics`/… npm-script soup collapsed to `ics` / `strikes`.
- **First tests.** Vitest pins the deterministic core — stable ICS/strikes roots, leaf
  encodings, proof round-trips, address/strikes parsing, and the IPFS client's URL/credential
  resolution + request shape (mocked `fetch`, no network).
