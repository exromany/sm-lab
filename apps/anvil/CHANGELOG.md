# @sm-lab/anvil

## 0.1.0

### Minor Changes

- f56d596: New package `@sm-lab/anvil` (bin `sm-anvil`) — boot anvil forking mainnet with the Lido SM
  upgrade state baked in, in one command:

  ```bash
  npx @sm-lab/anvil                # anvil on :8545, mainnet fork + upgrade overlay
  npx @sm-lab/anvil --host 0.0.0.0 # flags pass straight through to anvil
  ```

  The 1 MB `anvil --dump-state` snapshot ships inside the package (versioned data), so there's
  nothing to clone or download. It's a fork dump — only the upgrade-touched contracts are
  captured — so anvil forks mainnet behind the overlay; un-captured reads fall through to the RPC.
  Requires Foundry (`anvil`) on PATH and a mainnet archive RPC via `MAINNET_RPC_URL`
  (or `ANVIL_FORK_URL` / `ETH_RPC_URL`), read from the environment or a `.env` in the cwd.
