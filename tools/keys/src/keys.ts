import { SecretKey } from '@chainsafe/bls/herumi';
import { deriveEth2ValidatorKeys, deriveKeyFromMnemonic } from '@chainsafe/bls-keygen';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
  CHAINS,
  DEPOSIT_AMOUNT_GWEI,
  DEPOSIT_CLI_VERSION,
  type ChainName,
  type WcType,
} from './constants';
import { bytesToHex, hexToBytes, type Hex } from './hex';
import { DepositData, DepositMessage, computeDomain, computeSigningRoot } from './ssz';

export interface MakeDepositKeysOptions {
  chain?: ChainName;
  count?: number;
  mnemonic?: string;
  type?: WcType;
  withdrawalAddress?: Hex;
  startIndex?: number;
}

export interface DepositKey {
  pubkey: Hex;
  withdrawal_credentials: Hex;
  amount: number;
  signature: Hex;
  deposit_message_root: Hex;
  deposit_data_root: Hex;
  fork_version: Hex;
  network_name: ChainName;
  deposit_cli_version: string;
}

export interface MakeDepositKeysResult {
  mnemonic: string;
  keys: DepositKey[];
}

/** type_byte ++ 11 zero bytes ++ 20-byte eth1 address = 32-byte 0x01/0x02 credential. */
export function withdrawalCredentials(type: WcType, address: Hex): Uint8Array {
  const addr = hexToBytes(address);
  if (addr.length !== 20) {
    throw new Error(`withdrawal address must be 20 bytes, got ${addr.length}`);
  }
  const wc = new Uint8Array(32);
  wc[0] = type === '0x02' ? 0x02 : 0x01;
  wc.set(addr, 12);
  return wc;
}

export async function makeDepositKeys(
  opts: MakeDepositKeysOptions = {},
): Promise<MakeDepositKeysResult> {
  const chain = opts.chain ?? 'hoodi';
  const count = opts.count ?? 1;
  const type = opts.type ?? '0x01';
  const startIndex = opts.startIndex ?? 0;

  const cfg = CHAINS[chain];
  if (!cfg) throw new Error(`unknown chain: ${String(chain)} (expected mainnet | hoodi)`);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${count}`);
  }
  if (type !== '0x01' && type !== '0x02') {
    throw new Error(`type must be 0x01 or 0x02, got ${String(type)}`);
  }

  const mnemonic = opts.mnemonic ?? generateMnemonic(wordlist, 128);
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('invalid BIP-39 mnemonic');

  const wc = withdrawalCredentials(type, opts.withdrawalAddress ?? cfg.withdrawalVault);
  const amount = BigInt(DEPOSIT_AMOUNT_GWEI);
  const domain = computeDomain(hexToBytes(cfg.forkVersion));

  const master = deriveKeyFromMnemonic(mnemonic);
  const keys: DepositKey[] = [];
  for (let i = 0; i < count; i++) {
    const { signing } = deriveEth2ValidatorKeys(master, startIndex + i);
    const sk = SecretKey.fromBytes(signing);
    const pubkey = sk.toPublicKey().toBytes();
    const messageRoot = DepositMessage.hashTreeRoot({
      pubkey,
      withdrawal_credentials: wc,
      amount,
    });
    const signingRoot = computeSigningRoot(messageRoot, domain);
    const signature = sk.sign(signingRoot).toBytes();
    const dataRoot = DepositData.hashTreeRoot({
      pubkey,
      withdrawal_credentials: wc,
      amount,
      signature,
    });
    keys.push({
      pubkey: bytesToHex(pubkey),
      withdrawal_credentials: bytesToHex(wc),
      amount: DEPOSIT_AMOUNT_GWEI,
      signature: bytesToHex(signature),
      deposit_message_root: bytesToHex(messageRoot),
      deposit_data_root: bytesToHex(dataRoot),
      fork_version: cfg.forkVersion,
      network_name: cfg.networkName,
      deposit_cli_version: DEPOSIT_CLI_VERSION,
    });
  }

  return { mnemonic, keys };
}
