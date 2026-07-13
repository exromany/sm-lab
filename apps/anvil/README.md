# @sm-lab/anvil

Boot [anvil](https://book.getfoundry.sh/anvil/) forking mainnet with the **Lido SM upgrade
state overlaid** — one command, no repo to clone. The state snapshot ships inside this package.

## Quick start

```sh
npx @sm-lab/anvil                # binary is sm-anvil; anvil on 127.0.0.1:8545
npx @sm-lab/anvil --host 0.0.0.0 # every flag passes straight through to anvil
```

## Prerequisites

`npx` fetches this package, but it cannot supply the two things anvil itself needs:

1. **Foundry** — the `anvil` binary on your `PATH` ([install](https://getfoundry.sh)).
2. **A mainnet _archive_ RPC** — set one of `MAINNET_RPC_URL`, `ANVIL_FORK_URL`, or
   `ETH_RPC_URL`, in the environment or a `.env` in the current directory. It must be able to
   serve the fork block (`25523407`).

An explicit environment variable always wins over a value in `.env`.

## Why a fork is required

The baked state (`state/mainnet-upgraded.state.json`) is an `anvil --dump-state` **fork dump**:
it captures only the ~50 accounts the upgrade touched, and its tip block header lives on the
chain, not in the file. So `anvil --load-state` alone can't boot it — anvil must fork mainnet
behind the overlay, and any un-captured read (LidoLocator, stETH, the withdrawal queue,
balances, …) falls through to the RPC. That's why an archive endpoint is required rather than a
fully offline file.

## Overrides

| Variable           | Default                 | Purpose                               |
| ------------------ | ----------------------- | ------------------------------------- |
| `ANVIL_FORK_BLOCK` | `25523407`              | Fork base block (must match the dump) |
| `ANVIL_STATE_FILE` | the baked `state/…json` | Load a different state dump           |

## How it works

`sm-anvil` resolves the RPC and state path, then execs:

```sh
anvil --fork-url <rpc> --fork-block-number 25523407 --load-state <state> [your flags...]
```

stdio is inherited and `SIGINT`/`SIGTERM` are forwarded, so it behaves like running `anvil`
directly. It exits with anvil's own exit code.
