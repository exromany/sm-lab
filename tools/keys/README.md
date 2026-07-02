# @sm-lab/keys

Real BLS12-381 validator **deposit-data** generator for Lido SM (mainnet / hoodi).
Pure TypeScript — no chain, no Foundry, no external binary. Replaces `eth-staking-smith`
for sm-lab / consumer test suites.

Keys are EIP-2333/2334 derived from a BIP-39 mnemonic and signed against the deposit
domain, so they pass the CSM SDK's on-upload BLS validation.

## CLI

```bash
sm-keys 5                               # count is positional: `5` == `--count 5`
sm-keys --count 5                       # hoodi, 0x01 (all defaults) → JSON to stdout
sm-keys --chain mainnet --count 1
sm-keys --count 1 --type 0x02           # compounding (CM)
sm-keys --count 3 --mnemonic "..."      # reproducible
sm-keys --count 2 --wc 0xCustomAddress  # withdrawal address override
sm-keys --count 5 -o deposit_data.json  # write file (mnemonic → stderr)
sm-keys --count 2 --json                # structured JSON result to stdout (mnemonic + keys)
sm-keys help                            # mirrors --help
sm-keys completion fish | source        # shell completion (bash | zsh | fish)
```

`count` is also a positional argument, so `sm-keys 2` == `sm-keys --count 2` (the positional
wins if both are given). `sm-keys help` mirrors `sm-keys --help`.

### FLAGS

| flag                       | default    | notes                                                      |
| -------------------------- | ---------- | ---------------------------------------------------------- |
| `--chain <mainnet\|hoodi>` | `hoodi`    |                                                            |
| `--count <n>`              | `1`        |                                                            |
| `--type <0x01\|0x02>`      | `0x01`     | `0x02` = compounding                                       |
| `--mnemonic <phrase>`      | random     | BIP-39 (128-bit when omitted)                              |
| `--wc <address>`           | Lido vault | eth1 address override                                      |
| `--start-index <n>`        | `0`        | first validator index                                      |
| `-o, --out <path>`         | —          | write `deposit_data.json`; else stdout                     |
| `--json`                   | —          | emit `{ mnemonic, keys[] }` as JSON to stdout; exit 0 or 1 |

With `--json` the output is a single JSON value (`JSON.stringify`, 2-space indent) on stdout.
`keys` fields keep their `0x`-prefixed hex form. Errors go to stderr; exit code 1.

## TS API

```ts
import { makeDepositKeys, writeDepositDataFile } from '@sm-lab/keys';

const { mnemonic, keys } = await makeDepositKeys({ chain: 'hoodi', count: 5 });
writeDepositDataFile('deposit_data.json', keys);
```

### Options

- `chain` — `'mainnet'` or `'hoodi'` (default: `'hoodi'`)
- `count` — number of validator keys (required)
- `mnemonic?` — BIP-39 seed phrase (random 128-bit if omitted)
- `type?` — withdrawal type: `'0x01'` (eth1, default) or `'0x02'` (compounding)
- `withdrawalAddress?` — override Lido vault withdrawal address
- `startIndex?` — first validator index (default: 0)
