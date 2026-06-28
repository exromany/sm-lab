import type { Hex } from './hex';

export type ChainName = 'mainnet' | 'hoodi';
export type WcType = '0x01' | '0x02';

export interface ChainConfig {
  chainId: number;
  forkVersion: Hex; // 4-byte genesis/current fork version used in the deposit domain
  networkName: ChainName;
  withdrawalVault: Hex; // 20-byte Lido WithdrawalVault address (LidoLocator.withdrawalVault())
}

/** SSZ deposit domain type (DOMAIN_DEPOSIT), per the consensus spec. */
export const DOMAIN_DEPOSIT: Hex = '0x03000000';

/** The only deposit amount the CSM SDK validator accepts: 32 ETH in gwei. */
export const DEPOSIT_AMOUNT_GWEI = 32_000_000_000;

/** Cosmetic deposit_data.json field; not validated on-chain or by the widget. */
export const DEPOSIT_CLI_VERSION = 'csm-keys/0.1.0';

// WithdrawalVault proxy addresses per Lido deployed-contracts (mainnet + hoodi),
// fork versions + chainId per eth-clients (mainnet 0x00000000; hoodi 0x10000910, 560048).
// Verified against authoritative sources 2026-06-28. Re-verify on any network redeploy.
export const CHAINS: Record<ChainName, ChainConfig> = {
  mainnet: {
    chainId: 1,
    forkVersion: '0x00000000',
    networkName: 'mainnet',
    withdrawalVault: '0xB9D7934878B5FB9610B3fE8A5e441e8fad7E293f',
  },
  hoodi: {
    chainId: 560048,
    forkVersion: '0x10000910',
    networkName: 'hoodi',
    withdrawalVault: '0x4473dCDDbf77679A643BdB654dbd86D67F8d32f2',
  },
};
