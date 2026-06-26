import type { AddressBook } from './types';
import hoodiCsm from '../data/hoodi/csm.json';
import hoodiCm from '../data/hoodi/cm.json';
import mainnetCsm from '../data/mainnet/csm.json';

/** Default committed address books per (chain, module). cm exists for hoodi only. */
export const addresses = {
  hoodi: { csm: hoodiCsm as AddressBook, cm: hoodiCm as AddressBook },
  mainnet: { csm: mainnetCsm as AddressBook },
} as const;
