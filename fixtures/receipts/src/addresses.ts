import type { CsmAddressBook, CmAddressBook } from './types';
import hoodiCsm from '../data/hoodi/csm.json';
import hoodiCm from '../data/hoodi/cm.json';
import mainnetCsm from '../data/mainnet/csm.json';

/** Default committed address books per (chain, module). cm exists for hoodi only. */
export const addresses = {
  hoodi: { csm: hoodiCsm as unknown as CsmAddressBook, cm: hoodiCm as unknown as CmAddressBook },
  mainnet: { csm: mainnetCsm as unknown as CsmAddressBook },
} as const;
