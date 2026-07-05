import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProtocolAddresses } from '../src/types';

export type FieldKind = 'address' | 'address[]' | 'number' | 'string';
export interface FieldSpec {
  kind: FieldKind;
  optional?: boolean;
  /** Input key in the raw deploy snapshot, when it differs from the output key (rename). */
  source?: string;
  /** When set, read `snapshot[source][index]` — splits a source array into named fields. */
  index?: number;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Insertion order = output key order. Mirrors the TS interfaces in src/types.ts.
export const CSM_SCHEMA: Record<string, FieldSpec> = {
  CSModule: { kind: 'address' },
  Accounting: { kind: 'address' },
  FeeDistributor: { kind: 'address' },
  FeeOracle: { kind: 'address' },
  HashConsensus: { kind: 'address' },
  ParametersRegistry: { kind: 'address' },
  ValidatorStrikes: { kind: 'address' },
  Verifier: { kind: 'address' },
  Ejector: { kind: 'address' },
  ExitPenalties: { kind: 'address' },
  LidoLocator: { kind: 'address' },
  IcsGate: { kind: 'address', source: 'VettedGate' },
  PermissionlessGate: { kind: 'address' },
  IdvtcGate: { kind: 'address', optional: true, source: 'IdentifiedDVTClusterGate' },
  ChainId: { kind: 'number' },
  'git-ref': { kind: 'string' },
};

export const CM_SCHEMA: Record<string, FieldSpec> = {
  CuratedModule: { kind: 'address' },
  Accounting: { kind: 'address' },
  FeeDistributor: { kind: 'address' },
  FeeOracle: { kind: 'address' },
  HashConsensus: { kind: 'address' },
  ParametersRegistry: { kind: 'address' },
  ValidatorStrikes: { kind: 'address' },
  Verifier: { kind: 'address' },
  Ejector: { kind: 'address' },
  ExitPenalties: { kind: 'address' },
  MetaRegistry: { kind: 'address' },
  CuratedGateFactory: { kind: 'address' },
  LidoLocator: { kind: 'address' },
  // Flattened from the deploy config's `CuratedGates` array (order fixed by the deploy script:
  // PO, PTO, PGO, DO, EEO, IODC, IODCP — verified against lido-csm-sdk CONTRACT_NAMES).
  CuratedGatePO: { kind: 'address', source: 'CuratedGates', index: 0 },
  CuratedGatePTO: { kind: 'address', source: 'CuratedGates', index: 1 },
  CuratedGatePGO: { kind: 'address', source: 'CuratedGates', index: 2 },
  CuratedGateDO: { kind: 'address', source: 'CuratedGates', index: 3 },
  CuratedGateEEO: { kind: 'address', source: 'CuratedGates', index: 4 },
  CuratedGateIODC: { kind: 'address', source: 'CuratedGates', index: 5 },
  CuratedGateIODCP: { kind: 'address', source: 'CuratedGates', index: 6 },
  ChainId: { kind: 'number' },
  'git-ref': { kind: 'string' },
};

function validateField(name: string, value: unknown, spec: FieldSpec): void {
  if (spec.kind === 'address') {
    if (typeof value !== 'string' || !ADDRESS_RE.test(value))
      throw new Error(`curate: field "${name}" is not a 20-byte address: ${String(value)}`);
  } else if (spec.kind === 'address[]') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !ADDRESS_RE.test(v)))
      throw new Error(`curate: field "${name}" is not an array of addresses`);
  } else if (spec.kind === 'number') {
    if (typeof value !== 'number')
      throw new Error(`curate: field "${name}" is not a number: ${String(value)}`);
  } else if (typeof value !== 'string') {
    throw new Error(`curate: field "${name}" is not a string: ${String(value)}`);
  }
}

/**
 * Allowlist-curate a deploy snapshot to the schema. Validates required fields,
 * emits in schema order, and returns the source keys that were dropped.
 */
export function curate(
  snapshot: Record<string, unknown>,
  schema: Record<string, FieldSpec>,
): { book: Record<string, unknown>; dropped: string[] } {
  const book: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    const src = spec.source ?? name;
    const raw = snapshot[src];
    const value = spec.index === undefined ? raw : Array.isArray(raw) ? raw[spec.index] : undefined;
    if (value === undefined) {
      if (spec.optional) continue;
      const from = spec.index === undefined ? `"${src}"` : `"${src}[${spec.index}]"`;
      throw new Error(`curate: required field "${name}" missing from snapshot (${from})`);
    }
    validateField(name, value, spec);
    book[name] = value;
  }
  // Source keys are consumed (renamed/flattened), so they aren't "dropped".
  const sources = new Set(Object.values(schema).flatMap((s) => (s.source ? [s.source] : [])));
  const dropped = Object.keys(snapshot).filter((k) => !(k in schema) && !sources.has(k));
  return { book, dropped };
}

const PROTOCOL_KEYS = [
  'stakingRouter',
  'validatorsExitBusOracle',
  'lido',
  'withdrawalQueue',
  'burner',
  'withdrawalVault',
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/** Validate a raw locator-read map into a typed ProtocolAddresses (non-zero addresses). */
export function assertProtocol(raw: Record<string, unknown>): ProtocolAddresses {
  const out = {} as Record<string, string>;
  for (const key of PROTOCOL_KEYS) {
    const v = raw[key];
    if (typeof v !== 'string' || !ADDRESS_RE.test(v) || v.toLowerCase() === ZERO)
      throw new Error(`assertProtocol: "${key}" is not a non-zero address: ${String(v)}`);
    out[key] = v;
  }
  return out as unknown as ProtocolAddresses;
}

/**
 * Logical contract name → `out/` artifact basename. Upstream Lido contracts are
 * compiled by the contracts repo as INTERFACES only, so they map to their
 * `I`-prefixed artifacts; module/suite contracts use their impl artifacts.
 */
export const CONTRACT_SOURCES = {
  // module + suite impls (out/<C>.sol/<C>.json)
  CSModule: 'CSModule',
  CuratedModule: 'CuratedModule',
  Accounting: 'Accounting',
  FeeDistributor: 'FeeDistributor',
  FeeOracle: 'FeeOracle',
  HashConsensus: 'HashConsensus',
  VettedGate: 'VettedGate',
  CuratedGate: 'CuratedGate',
  PermissionlessGate: 'PermissionlessGate',
  ParametersRegistry: 'ParametersRegistry',
  MetaRegistry: 'MetaRegistry',
  Verifier: 'Verifier',
  // upstream protocol interfaces (out/I<C>.sol/I<C>.json)
  VEBO: 'IVEBO',
  StakingRouter: 'IStakingRouter',
  Lido: 'ILido',
  LidoLocator: 'ILidoLocator',
} as const;

export type ContractName = keyof typeof CONTRACT_SOURCES;

export function readAbi(outDir: string, source: string): unknown[] {
  const p = path.join(outDir, `${source}.sol`, `${source}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `ABI artifact not found at ${p} (did you run \`forge build\` in the contracts repo?)`,
    );
  }
  const artifact = JSON.parse(fs.readFileSync(p, 'utf8')) as { abi?: unknown[] };
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`No 'abi' array in ${p}`);
  }
  return artifact.abi;
}

export function extractAbis(outDir: string): Record<ContractName, unknown[]> {
  const out = {} as Record<ContractName, unknown[]>;
  for (const name of Object.keys(CONTRACT_SOURCES) as ContractName[]) {
    out[name] = readAbi(outDir, CONTRACT_SOURCES[name]);
  }
  return out;
}

export function abiHash(abi: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(abi)).digest('hex');
}

export function abiVarName(name: string): string {
  // Lowercase the leading run of capitals that begins a word (CSModule -> csModule),
  // else just the first char (VEBO -> vEBO, Lido -> lido). Then suffix 'Abi'.
  return name.replace(/^[A-Z]+(?=[A-Z][a-z])|^[A-Z]/, (m) => m.toLowerCase()) + 'Abi';
}

export function renderAbiModule(varName: string, abi: unknown[]): string {
  return `// AUTO-GENERATED by scripts/refresh.ts — do not edit.\nexport const ${varName} = ${JSON.stringify(abi, null, 2)} as const;\n`;
}

export function renderAbiIndex(names: readonly string[]): string {
  const sorted = [...names].toSorted();
  const lines = sorted.map((n) => `export { ${abiVarName(n)} } from './${n}';`);
  return `// AUTO-GENERATED by scripts/refresh.ts — do not edit.\n${lines.join('\n')}\n`;
}

export function checkGitRef(headRef: string, deployRef: string, force: boolean): void {
  if (!force && headRef !== deployRef) {
    throw new Error(
      `Contracts HEAD ${headRef} != deployment git-ref ${deployRef}. ` +
        `Check out ${deployRef} in the contracts repo and rebuild, or pass --force.`,
    );
  }
}

export interface DeploySnapshot {
  'git-ref'?: string;
  [key: string]: unknown;
}

export function readDeploySnapshot(filePath: string): DeploySnapshot {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deploy snapshot not found at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as DeploySnapshot;
}

export interface SnapshotRef {
  chain: string;
  module: string;
  gitRef: string;
}

export interface Manifest {
  abiGitRef: string;
  abiHashes: Record<string, string>;
  snapshots: SnapshotRef[];
  protocolResolvedAt?: Record<string, { chainId: number; block: number }>;
  generatedAt: string;
}

export function mergeManifest(
  prev: Manifest | null,
  next: {
    abiGitRef: string;
    abiHashes: Record<string, string>;
    snapshot: SnapshotRef;
    generatedAt: string;
    protocolResolvedAt?: { key: string; chainId: number; block: number };
  },
): Manifest {
  const snapshots = (prev?.snapshots ?? []).filter(
    (s) => !(s.chain === next.snapshot.chain && s.module === next.snapshot.module),
  );
  snapshots.push(next.snapshot);

  const resolved = { ...prev?.protocolResolvedAt };
  if (next.protocolResolvedAt) {
    resolved[next.protocolResolvedAt.key] = {
      chainId: next.protocolResolvedAt.chainId,
      block: next.protocolResolvedAt.block,
    };
  }

  return {
    abiGitRef: next.abiGitRef,
    abiHashes: next.abiHashes,
    // Codepoint sort (locale-independent) so the committed manifest is reproducible across machines.
    snapshots: snapshots.toSorted((a, b) => {
      const ka = `${a.chain}/${a.module}`;
      const kb = `${b.chain}/${b.module}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }),
    ...(Object.keys(resolved).length > 0 ? { protocolResolvedAt: resolved } : {}),
    generatedAt: next.generatedAt,
  };
}
