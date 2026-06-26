/** A deploy address book: contract name → address (or array/number for CuratedGates/ChainId). */
export type AddressBook = Record<string, string | string[] | number | Record<string, unknown>>;
export type ChainName = 'hoodi' | 'mainnet';
export type ModuleName = 'csm' | 'cm';
