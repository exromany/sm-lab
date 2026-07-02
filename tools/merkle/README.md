# @sm-lab/merkle

Merkle tree builder for Lido SM. One job: **build a tree, pin it to IPFS, print the root +
CID.** Tree shapes — **addresses** (vetted gate), **strikes** (node-operator violations), and
**rewards** (cumulative FeeDistributor shares).

```
input JSON → build StandardMerkleTree → pin to IPFS → print { treeRoot, treeCid }
```

> Pushing the root/CID on-chain (and resolving deploy addresses) is **not** this tool's job —
> that belongs to `@sm-lab/receipts`. merkle has no `cast`, no `DEPLOY_JSON_PATH`, no chain access.

## CLI

Binary: `sm-merkle` (`npx @sm-lab/merkle …`).

```bash
sm-merkle 0xABC 0xDEF                           # inline addresses → addresses (vetted gate) tree (default command)
sm-merkle addresses --source addresses.json     # addresses (vetted gate) tree from file
sm-merkle addresses --input 0xABC --input 0xDEF # addresses (vetted gate) tree from repeated --input flags
sm-merkle strikes strikes.json                  # build strikes tree, pin, print root + CID
sm-merkle rewards --source rewards.json         # build rewards tree from [[noId, shares], ...]
sm-merkle addresses --source a.json --no-upload # build/print root only, skip pinning
sm-merkle addresses --source a.json -o out.json # also write { treeRoot, treeCid } to out.json
sm-merkle help                                  # self-contained cheat sheet
sm-merkle completion fish | source              # shell completion (bash/zsh/fish)
```

Flags: `--no-upload` (root only, skip IPFS) · `-o, --out <path>` (also write a
`{ treeRoot, treeCid }` JSON — a handoff seam for `@sm-lab/receipts` / CI) · `--json`
(machine-readable single-JSON-value output).

## Library

### Low-level (build + pin manually)

```ts
import { buildAddressesTree, buildStrikesTree, pinJsonToIpfs } from '@sm-lab/merkle';

const tree = buildAddressesTree(['0x70997970…', '0x3C44CdD…']);
tree.root; // deterministic 0x… root
const cid = await pinJsonToIpfs(tree.dump(), 'merkle-tree-addresses'); // env-switched endpoint
```

### High-level TS API

`makeAddresses` accepts a resolved `string[]` of addresses, builds the tree, pins the dump to IPFS
(using the env-configured endpoint — local `@sm-lab/ipfs` by default), and returns
`{ treeRoot, treeCid }`. No filesystem access — pass the address list directly.

```ts
import { makeAddresses } from '@sm-lab/merkle';

// Build + pin in one call. Addresses must already be resolved (inline list or pre-read file).
const { treeRoot, treeCid } = await makeAddresses(
  ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'],
  // options are optional:
  // { noUpload: true }   → skip IPFS, return only treeRoot
  // { configPath: 'out.json' } → also write { treeRoot, treeCid } to disk
);

console.log('tree root:', treeRoot);
console.log('IPFS CID: ', treeCid);
```

Tree leaf encodings: addresses (vetted gate) `["address"]` · strikes `["uint256", "string", "uint256[]"]` · rewards `["uint256", "uint256"]`.

## Environment

| Var                                    | Purpose                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IPFS_API_URL`                         | Pinning endpoint. **Unset → local `@sm-lab/ipfs`** (`http://127.0.0.1:5001`). Pinata is used only when `PINATA_*` creds are set (and `IPFS_API_URL` is unset). Set explicitly to override both defaults. |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | Pinata credentials (`pinata_api_key` / `pinata_secret_api_key` headers). When set, Pinata is preferred over the local default.                                                                           |
| `PINATA_JWT`                           | Alternative to key/secret (`Authorization: Bearer …`). When set, Pinata is preferred over the local default.                                                                                             |

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
