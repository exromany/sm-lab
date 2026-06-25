import { describe, it, expect, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseAddresses,
  readAddressFile,
  readStrikesFile,
  readJsonFile,
  writeJsonFile,
  type TreeConfig,
} from '../src/io';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, 'fixtures', name);

describe('parseAddresses', () => {
  it('parses a JSON array', () => {
    expect(parseAddresses('["0xabc", "0xdef"]')).toEqual(['0xabc', '0xdef']);
  });

  it('parses newline-delimited text, ignoring comments and blanks', () => {
    const text = '# header\n0xabc\n\n  0xdef  \n# trailing';
    expect(parseAddresses(text)).toEqual(['0xabc', '0xdef']);
  });

  it('reads the same addresses from JSON and text fixtures', () => {
    expect(readAddressFile(fixture('addresses.json'))).toEqual(
      readAddressFile(fixture('addresses.txt')),
    );
  });
});

describe('readStrikesFile', () => {
  it('parses strikes.json into typed entries', () => {
    const entries = readStrikesFile(fixture('strikes.json'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ nodeOperatorId: 4, strikes: [0, 0, 0, 0, 0, 1] });
  });
});

describe('writeJsonFile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-merkle-'));
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('writes the { treeRoot, treeCid } handoff file, creating nested parent dirs', () => {
    const tmp = path.join(tmpDir, 'nested', 'config.json');
    const config: TreeConfig = { treeRoot: '0xroot', treeCid: 'cid123' };
    writeJsonFile(tmp, config);
    expect(readJsonFile<TreeConfig>(tmp)).toEqual(config);
  });
});
