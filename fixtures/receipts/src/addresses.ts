import type { CsmAddressBook, CmAddressBook, Csm02AddressBook } from './types';
import hoodiCsm from '../data/hoodi/csm.json';
import hoodiCm from '../data/hoodi/cm.json';
// TODO(csm02): placeholder — replaced by the hoodi refresh.
import hoodiCsm02 from '../data/hoodi/csm02.json';
import mainnetCsm from '../data/mainnet/csm.json';
import mainnetCm from '../data/mainnet/cm.json';

/** Default committed address books per (chain, module). csm02 is hoodi-only (not deployed on mainnet). */
export const addresses = {
  hoodi: {
    csm: hoodiCsm as unknown as CsmAddressBook,
    cm: hoodiCm as unknown as CmAddressBook,
    csm02: hoodiCsm02 as unknown as Csm02AddressBook,
  },
  mainnet: {
    csm: mainnetCsm as unknown as CsmAddressBook,
    cm: mainnetCm as unknown as CmAddressBook,
  },
} as const;
