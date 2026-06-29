import { addresses as RECEIPTS, type AddressBook } from '@csm-lab/receipts';
import type { Hex } from './hex';

/** The baked Lido WithdrawalVault for a chainId, or undefined if no receipts book has been enriched. */
export function protocolWithdrawalVault(
  chainId: number,
  books: typeof RECEIPTS = RECEIPTS,
): Hex | undefined {
  const all = Object.values(books).flatMap((m) => Object.values(m)) as AddressBook[];
  const match = all.find((b) => b.ChainId === chainId);
  return match?.protocol?.withdrawalVault;
}
