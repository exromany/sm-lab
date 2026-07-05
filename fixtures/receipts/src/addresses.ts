import type { CsmAddressBook, CmAddressBook } from './types';
import hoodiCsm from '../data/hoodi/csm.json';
import hoodiCm from '../data/hoodi/cm.json';
import mainnetCsm from '../data/mainnet/csm.json';
import mainnetCm from '../data/mainnet/cm.json';

/** Default committed address books per (chain, module). */
export const addresses = {
  hoodi: { csm: hoodiCsm as unknown as CsmAddressBook, cm: hoodiCm as unknown as CmAddressBook },
  mainnet: {
    csm: mainnetCsm as unknown as CsmAddressBook,
    cm: mainnetCm as unknown as CmAddressBook,
  },
} as const;
