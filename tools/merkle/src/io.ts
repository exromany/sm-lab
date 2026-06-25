import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StrikesEntry } from './tree';

/**
 * Pure file I/O helpers. Kept small and side-effect-explicit so the deterministic parsing
 * (address-file, strikes.json) can be unit-tested against fixtures.
 */

/** The `{ treeRoot, treeCid }` shape written by the optional `-o` handoff file. */
export interface TreeConfig {
  treeRoot: string;
  treeCid: string;
}

/** Read+parse a JSON file as `T`. Throws (with the path) if missing. */
export function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

/**
 * Parse an address list. Accepts either a JSON array (`["0x..", ...]`) or a newline-delimited
 * text file (blank lines and `#` comments ignored) — the original tool supported both shapes.
 */
export function parseAddresses(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as string[];
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Read and parse an address file (JSON array or newline-delimited text). */
export function readAddressFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at ${filePath}`);
  }
  return parseAddresses(fs.readFileSync(filePath, 'utf-8'));
}

/** Read and parse a strikes.json file. */
export function readStrikesFile(filePath: string): StrikesEntry[] {
  return readJsonFile<StrikesEntry[]>(filePath);
}

/** Write a JSON file, creating parent directories as needed. */
export function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
