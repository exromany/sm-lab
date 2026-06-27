import { createTestClient, http, publicActions, walletActions } from 'viem';

/**
 * The single viem client recipes use. An anvil test client (for setBalance /
 * impersonateAccount / increaseTime / snapshot) extended with public actions
 * (readContract / simulateContract / getChainId) and wallet actions (writeContract).
 * No `chain` is set — anvil forks vary by chainId, so writes pass `chain: null`.
 */
export function makeClient(rpcUrl: string) {
  return createTestClient({ mode: 'anvil', transport: http(rpcUrl) })
    .extend(publicActions)
    .extend(walletActions);
}

/** Structural type recipes depend on — satisfied by makeClient's return or a test fake. */
export type RecipeClient = ReturnType<typeof makeClient>;
