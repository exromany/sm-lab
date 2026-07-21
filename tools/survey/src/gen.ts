import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

export function randomAddress(): string {
  return privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
}

export function placeholderSignature(): string {
  return '0x' + '00'.repeat(65);
}

export function assertAddress(value: string): string {
  return getAddress(value).toLowerCase();
}

export function resolveAddress(explicit?: string): string {
  return explicit ? assertAddress(explicit) : randomAddress();
}
