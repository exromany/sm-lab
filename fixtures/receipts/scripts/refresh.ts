import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadEnv } from 'dotenv';
import {
  extractAbis,
  abiHash,
  abiVarName,
  renderAbiModule,
  renderAbiIndex,
  checkGitRef,
  readDeploySnapshot,
  mergeManifest,
  curate,
  assertProtocol,
  CSM_SCHEMA,
  CM_SCHEMA,
  type Manifest,
  type ContractName,
} from './refresh-lib';
import type { Hex, ProtocolAddresses } from '../src/types';

export type EnrichFn = (
  locator: string,
) => Promise<{ protocol: ProtocolAddresses; chainId: number; block: number }>;

export interface RefreshOptions {
  contractsPath: string;
  chain: string;
  module: 'csm' | 'cm';
  pkgDir: string;
  headRef: string;
  force: boolean;
  generatedAt: string;
  configPath?: string;
  enrich?: EnrichFn;
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

function readPriorProtocol(addressFile: string): ProtocolAddresses | undefined {
  if (!fs.existsSync(addressFile)) return undefined;
  const prior = JSON.parse(fs.readFileSync(addressFile, 'utf8')) as {
    protocol?: ProtocolAddresses;
  };
  return prior.protocol;
}

export async function runRefresh(opts: RefreshOptions): Promise<RefreshResult> {
  const { contractsPath, chain, module, pkgDir, headRef, force, generatedAt } = opts;

  // 1. git-ref guard.
  const snapPath = opts.configPath
    ? path.resolve(contractsPath, opts.configPath)
    : deployJsonPath(contractsPath, chain, module);
  const snapshot = readDeploySnapshot(snapPath);
  const deployRef = snapshot['git-ref'] ?? '';
  checkGitRef(headRef, deployRef, force);

  // 2. ABIs → src/abi/<name>.ts + index, and hashes for the manifest.
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

  // 3. Curate the snapshot to the allowlist; warn on dropped keys.
  const schema = module === 'cm' ? CM_SCHEMA : CSM_SCHEMA;
  const { book, dropped } = curate(snapshot, schema);
  if (dropped.length > 0) console.warn(`  dropped ${dropped.length} key(s): ${dropped.join(', ')}`);

  // 4. Enrich protocol addresses (or carry forward the prior file's block).
  const addressFile = path.join(pkgDir, 'data', chain, `${module}.json`);
  let protocolResolvedAt: { key: string; chainId: number; block: number } | undefined;
  if (opts.enrich) {
    const { protocol, chainId, block } = await opts.enrich(book.LidoLocator as string);
    book.protocol = assertProtocol(protocol as unknown as Record<string, unknown>);
    protocolResolvedAt = { key: `${chain}/${module}`, chainId, block };
  } else {
    const prior = readPriorProtocol(addressFile);
    if (prior) book.protocol = prior;
    else console.warn('  no RPC/enrich — protocol block omitted (consumers fall back at runtime)');
  }

  // 5. Write curated+enriched book.
  writeFile(addressFile, JSON.stringify(book, null, 2) + '\n');

  // 6. Manifest (+ provenance).
  const manifestFile = path.join(pkgDir, 'data', 'manifest.json');
  const manifest = mergeManifest(readManifest(manifestFile), {
    abiGitRef: headRef,
    abiHashes,
    snapshot: { chain, module, gitRef: deployRef },
    generatedAt,
    protocolResolvedAt,
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
  rpcUrl?: string;
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
  const contractsPath = path.resolve(pkgDir, get('--contracts') ?? '../../../staking-modules');
  const configPath = get('--config');
  const rpcUrl =
    get('--rpc') ?? process.env[`${chain.toUpperCase()}_RPC_URL`] ?? process.env.ETH_RPC_URL;
  return {
    chain,
    module: moduleArg,
    contractsPath,
    force: argv.includes('--force'),
    pkgDir,
    configPath,
    rpcUrl,
  };
}

async function main(): Promise<void> {
  // RPC creds come from the repo-root .env (this script lives at fixtures/receipts/scripts/).
  // Loaded here, not at import, so the hermetic test suite never picks up a developer's .env.
  loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });
  const { chain, module, contractsPath, force, pkgDir, configPath, rpcUrl } = parseArgs(
    process.argv.slice(2),
  );
  const headRef = execFileSync('git', ['-C', contractsPath, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  let enrich: EnrichFn | undefined;
  if (rpcUrl) {
    const { createPublicClient, http } = await import('viem');
    const { lidoLocatorAbi } = await import('../src/abi/LidoLocator');
    const client = createPublicClient({ transport: http(rpcUrl) });
    enrich = async (locator) => {
      const loc = { address: locator as Hex, abi: lidoLocatorAbi } as const;
      const fns = [
        'stakingRouter',
        'validatorsExitBusOracle',
        'lido',
        'withdrawalQueue',
        'burner',
        'withdrawalVault',
      ] as const;
      const values = await Promise.all(
        fns.map((functionName) => client.readContract({ ...loc, functionName })),
      );
      const protocol = assertProtocol(Object.fromEntries(fns.map((k, i) => [k, values[i]])));
      const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
      return { protocol, chainId, block: Number(block) };
    };
  } else {
    console.warn('⚠ no --rpc / *_RPC_URL — skipping protocol enrichment');
  }

  const res = await runRefresh({
    contractsPath,
    chain,
    module,
    pkgDir,
    headRef,
    force,
    generatedAt: new Date().toISOString(),
    configPath,
    enrich,
  });
  console.log(`refreshed ${chain}/${module}:`);
  console.log(`  ${res.abiFiles.length} abi modules`);
  console.log(`  addresses → ${res.addressFile}`);
  console.log(`  manifest  → ${res.manifestFile}`);
}

// Run only as a script, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
