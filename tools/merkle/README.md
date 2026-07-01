# @sm-lab/merkle

Merkle tree builder for Lido CSM. One job: **build a tree, pin it to IPFS, print the root +
CID.** Two tree shapes — **ICS** (vetted-gate addresses) and **strikes** (node-operator
violations).

```
input JSON → build StandardMerkleTree → pin to IPFS → print { treeRoot, treeCid }
```

> Pushing the root/CID on-chain (and resolving deploy addresses) is **not** this tool's job —
> that belongs to `@sm-lab/receipts`. merkle has no `cast`, no `DEPLOY_JSON_PATH`, no chain access.

## CLI

Binary: `sm-merkle` (`npx @sm-lab/merkle …`).

```bash
sm-merkle ics addresses.json              # build ICS tree, pin, print root + CID
sm-merkle strikes strikes.json            # build strikes tree, pin, print root + CID
sm-merkle ics addresses.json --no-upload  # build/print root only, skip pinning
sm-merkle ics addresses.json -o out.json  # also write { treeRoot, treeCid } to out.json
sm-merkle help                            # self-contained cheat sheet
```

Flags: `--no-upload` (root only, skip IPFS) · `-o, --out <path>` (also write a
`{ treeRoot, treeCid }` JSON — a handoff seam for `@sm-lab/receipts` / CI).

## Library

```ts
import { buildIcsTree, buildStrikesTree, pinJsonToIpfs, makeIcs } from '@sm-lab/merkle';

const tree = buildIcsTree(['0x70997970…', '0x3C44CdD…']);
tree.root; // deterministic 0x… root
const cid = await pinJsonToIpfs(tree.dump(), 'merkle-tree-ics'); // env-switched endpoint
```

Tree leaf encodings: ICS `["address"]` · strikes `["uint256", "string", "uint256[]"]`.

## Environment

| Var                                    | Purpose                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IPFS_API_URL`                         | Pinning endpoint. **Unset → real Pinata** (`https://api.pinata.cloud`). Point at `@sm-lab/ipfs` for local runs (e.g. `http://127.0.0.1:5001`) — a custom endpoint pins **without** Pinata credentials. |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | Pinata credentials (`pinata_api_key` / `pinata_secret_api_key` headers).                                                                                                                               |
| `PINATA_JWT`                           | Alternative to key/secret (`Authorization: Bearer …`).                                                                                                                                                 |

Copy `.env` from your own values; never commit secrets (`.env*` is gitignored).

### Why a custom IPFS client, not `@pinata/sdk`

`@pinata/sdk` v2 hardcodes `baseUrl = 'https://api.pinata.cloud'` with no host override, so it
can't target the local mock. `ipfs.ts` is a thin `fetch` client that POSTs the **same**
`/pinning/pinJSONToIPFS` envelope (`{ pinataContent, pinataMetadata }`), with the base URL
resolved from `IPFS_API_URL` (→ env → real-Pinata default). Real Pinata works unchanged.

## Build

tsdown (ESM, bundled) via the shared `@sm-lab/config` preset:

```ts
// tsdown.config.ts
import { libConfig } from '@sm-lab/config/tsdown';
export default libConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
});
```
