import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  extractAbis,
  abiHash,
  abiVarName,
  renderAbiModule,
  renderAbiIndex,
  checkGitRef,
  readDeploySnapshot,
  mergeManifest,
  type Manifest,
  type ContractName,
} from './refresh-lib';

export interface RefreshOptions {
  contractsPath: string;
  chain: string;
  module: 'csm' | 'cm';
  pkgDir: string;
  headRef: string;
  force: boolean;
  generatedAt: string;
  configPath?: string;
}

export interface RefreshResult {
  abiFiles: string[];
  addressFile: string;
  manifestFile: string;
}

function deployJsonPath(contractsPath: string, chain: string, module: 'csm' | 'cm'): string {
  const sub =
    module === 'cm' ? path.join('curated', `deploy-${chain}.json`) : `deploy-${chain}.json`;
  return path.join(contractsPath, 'artifacts', chain, sub);
}

function readManifest(file: string): Manifest | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest) : null;
}

function writeFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

export function runRefresh(opts: RefreshOptions): RefreshResult {
  const { contractsPath, chain, module, pkgDir, headRef, force, generatedAt } = opts;

  // 1. git-ref guard: pair this run's ABIs (built from HEAD) with a matching deployment.
  const snapPath = opts.configPath
    ? path.resolve(contractsPath, opts.configPath)
    : deployJsonPath(contractsPath, chain, module);
  const snapshot = readDeploySnapshot(snapPath);
  const deployRef = snapshot['git-ref'] ?? '';
  checkGitRef(headRef, deployRef, force);

  // 2. ABIs → src/abi/<name>.ts (as const) + index, and hashes for the manifest.
  const abis = extractAbis(path.join(contractsPath, 'out'));
  const abiDir = path.join(pkgDir, 'src', 'abi');
  fs.rmSync(abiDir, { recursive: true, force: true });
  const abiFiles: string[] = [];
  const abiHashes: Record<string, string> = {};
  const names = Object.keys(abis) as ContractName[];
  for (const name of names) {
    const file = path.join(abiDir, `${name}.ts`);
    writeFile(file, renderAbiModule(abiVarName(name), abis[name]));
    abiFiles.push(file);
    abiHashes[name] = abiHash(abis[name]);
  }
  writeFile(path.join(abiDir, 'index.ts'), renderAbiIndex(names));

  // 3. Address snapshot copied verbatim → data/<chain>/<module>.json.
  const addressFile = path.join(pkgDir, 'data', chain, `${module}.json`);
  writeFile(addressFile, JSON.stringify(snapshot, null, 2) + '\n');

  // 4. Manifest (per-snapshot provenance + abi hashes).
  const manifestFile = path.join(pkgDir, 'data', 'manifest.json');
  const manifest = mergeManifest(readManifest(manifestFile), {
    abiGitRef: headRef,
    abiHashes,
    snapshot: { chain, module, gitRef: deployRef },
    generatedAt,
  });
  writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  return { abiFiles, addressFile, manifestFile };
}

function parseArgs(argv: string[]): {
  chain: string;
  module: 'csm' | 'cm';
  contractsPath: string;
  force: boolean;
  pkgDir: string;
  configPath?: string;
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const chain = get('--chain');
  const moduleArg = get('--module');
  if (!chain) throw new Error('Missing --chain (e.g. --chain hoodi)');
  if (moduleArg !== 'csm' && moduleArg !== 'cm')
    throw new Error('Missing/invalid --module (csm|cm)');
  const pkgDir = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
  const contractsPath = path.resolve(
    pkgDir,
    get('--contracts') ?? '../../../community-staking-module',
  );
  const configPath = get('--config');
  return {
    chain,
    module: moduleArg,
    contractsPath,
    force: argv.includes('--force'),
    pkgDir,
    configPath,
  };
}

function main(): void {
  const { chain, module, contractsPath, force, pkgDir, configPath } = parseArgs(
    process.argv.slice(2),
  );
  const headRef = execFileSync('git', ['-C', contractsPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const res = runRefresh({
    contractsPath,
    chain,
    module,
    pkgDir,
    headRef,
    force,
    generatedAt: new Date().toISOString(),
    configPath,
  });
  console.log(`refreshed ${chain}/${module}:`);
  console.log(`  ${res.abiFiles.length} abi modules`);
  console.log(`  addresses → ${res.addressFile}`);
  console.log(`  manifest  → ${res.manifestFile}`);
}

// Run only as a script, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
